<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\OwnerUser;
use App\Entity\OwnerUserLocationAccess;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

#[AsCommand(
    name: 'app:locals:sync-approved-claims',
    description: 'Grants Locals access to owner users whose email matches approved location claims.',
)]
final class SyncApprovedClaimsAccessCommand extends Command
{
    public function __construct(
        private readonly Connection $connection,
        private readonly HttpClientInterface $httpClient,
        private readonly ?string $coreApiBaseUrl,
        private readonly ?string $localsCoreSyncToken,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Preview approved-claim access sync without writing to the database.')
            ->addOption('skip-local-db', null, InputOption::VALUE_NONE, 'Validate Core approved-claims endpoint without reading the Locals database.')
            ->addOption('email', null, InputOption::VALUE_REQUIRED, 'Limit sync to one owner email.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $dryRun = (bool) $input->getOption('dry-run');
        $skipLocalDb = (bool) $input->getOption('skip-local-db');
        $email = $this->normalizeEmail($input->getOption('email'));

        if ($this->coreApiBaseUrl === null || trim($this->coreApiBaseUrl) === '') {
            $io->error('CORE_API_BASE_URL is not configured in Locals.');

            return Command::FAILURE;
        }

        if ($this->localsCoreSyncToken === null || trim($this->localsCoreSyncToken) === '') {
            $io->error('LOCALS_CORE_SYNC_TOKEN is not configured in Locals.');

            return Command::FAILURE;
        }

        if ($skipLocalDb) {
            $approvedClaims = $this->fetchApprovedClaims($email, $io);
            if ($approvedClaims === null) {
                return Command::FAILURE;
            }

            $io->table(
                ['Claim ID', 'Email', 'Core location ID', 'Local'],
                array_map(static fn (array $claim): array => [
                    (string) $claim['claim_id'],
                    (string) $claim['email'],
                    (string) $claim['canonical_location_id'],
                    (string) $claim['location_name'],
                ], $approvedClaims),
            );
            $io->success(sprintf('Core approved-claims endpoint is reachable. Returned %d approved claim(s).', count($approvedClaims)));

            return Command::SUCCESS;
        }

        try {
            $missingTables = $this->missingRequiredTables();
            $missingSchema = $missingTables;
            if ($missingTables === []) {
                $missingSchema = $this->missingRequiredAccessColumns();
            }
        } catch (\Throwable $exception) {
            $io->error(sprintf('Cannot connect to the Locals database: %s', $exception->getMessage()));

            return Command::FAILURE;
        }

        if ($missingSchema !== []) {
            $io->warning(sprintf(
                'Cannot sync approved claims because the current Locals database does not contain: %s.',
                implode(', ', $missingSchema),
            ));

            return Command::FAILURE;
        }

        $rows = $this->pendingAccessRows($email, $io);
        if ($rows === null) {
            return Command::FAILURE;
        }

        if ($rows === []) {
            $io->success('No approved claims need Locals access grants.');

            return Command::SUCCESS;
        }

        $io->table(
            ['Owner user ID', 'Email', 'Core location ID', 'Claim ID', 'Local'],
            array_map(static fn (array $row): array => [
                (string) $row['owner_user_id'],
                (string) $row['email'],
                (string) $row['core_location_id'],
                (string) $row['claim_id'],
                (string) $row['location_name'],
            ], $rows),
        );

        if ($dryRun) {
            $io->success(sprintf('Dry-run completed. Would apply %d approved-claim access sync row(s).', count($rows)));

            return Command::SUCCESS;
        }

        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        foreach ($rows as $row) {
            $this->connection->executeStatement(
                <<<'SQL'
                    INSERT INTO owner_user_location_access (
                        owner_user_id,
                        core_location_id,
                        role_key,
                        can_edit_profile,
                        can_manage_staff,
                        source_type,
                        source_claim_id,
                        granted_at,
                        updated_at,
                        created_at
                    ) VALUES (
                        :owner_user_id,
                        :core_location_id,
                        :role_key,
                        1,
                        1,
                        :source_type,
                        :source_claim_id,
                        :granted_at,
                        :updated_at,
                        :created_at
                    )
                    ON DUPLICATE KEY UPDATE
                        role_key = :role_key,
                        can_edit_profile = 1,
                        can_manage_staff = 1,
                        source_type = :source_type,
                        source_claim_id = :source_claim_id,
                        updated_at = :updated_at
                    SQL,
                [
                    'owner_user_id' => (int) $row['owner_user_id'],
                    'core_location_id' => (int) $row['core_location_id'],
                    'role_key' => OwnerUserLocationAccess::ROLE_OWNER,
                    'source_type' => OwnerUserLocationAccess::SOURCE_APPROVED_CLAIM,
                    'source_claim_id' => (int) $row['claim_id'],
                    'granted_at' => $now,
                    'updated_at' => $now,
                    'created_at' => $now,
                ],
                [
                    'owner_user_id' => ParameterType::INTEGER,
                    'core_location_id' => ParameterType::INTEGER,
                    'source_claim_id' => ParameterType::INTEGER,
                ],
            );
        }

        $io->success(sprintf('Applied %d Locals access sync row(s) from approved claims.', count($rows)));

        return Command::SUCCESS;
    }

    /**
     * @return list<string>
     */
    private function missingRequiredTables(): array
    {
        $schemaManager = $this->connection->createSchemaManager();
        $missing = [];
        foreach (['owner_users', 'owner_user_location_access'] as $tableName) {
            if (!$schemaManager->tablesExist([$tableName])) {
                $missing[] = $tableName;
            }
        }

        return $missing;
    }

    /**
     * @return list<string>
     */
    private function missingRequiredAccessColumns(): array
    {
        $schemaManager = $this->connection->createSchemaManager();
        $columns = array_change_key_case($schemaManager->listTableColumns('owner_user_location_access'), CASE_LOWER);
        $missing = [];
        foreach (['source_type', 'source_claim_id', 'granted_at', 'updated_at'] as $columnName) {
            if (!isset($columns[$columnName])) {
                $missing[] = sprintf('owner_user_location_access.%s', $columnName);
            }
        }

        return $missing;
    }

    /**
     * @return list<array{owner_user_id:int, email:string, core_location_id:int, claim_id:int, location_name:string}>|null
     */
    private function pendingAccessRows(?string $email, SymfonyStyle $io): ?array
    {
        $approvedClaims = $this->fetchApprovedClaims($email, $io);
        if ($approvedClaims === null || $approvedClaims === []) {
            return $approvedClaims;
        }

        $approvedClaims = $this->claimsWithoutAmbiguousDuplicates($approvedClaims, $io);
        $rows = [];
        $skippedMissingOwner = 0;
        $skippedInactiveOwner = 0;
        $skippedNonOwnerRole = 0;
        $skippedAlreadySynced = 0;
        $skippedConflictingClaim = 0;

        foreach ($approvedClaims as $claim) {
            $ownerUser = $this->connection->fetchAssociative(
                'SELECT id, email, role_key, status FROM owner_users WHERE email = :email LIMIT 1',
                ['email' => $claim['email']],
            );
            if (!is_array($ownerUser)) {
                ++$skippedMissingOwner;

                continue;
            }

            if ((string) $ownerUser['status'] !== OwnerUser::STATUS_ACTIVE) {
                ++$skippedInactiveOwner;

                continue;
            }

            if ((string) $ownerUser['role_key'] !== OwnerUser::ROLE_OWNER) {
                ++$skippedNonOwnerRole;

                continue;
            }

            $existingAccess = $this->connection->fetchAssociative(
                <<<'SQL'
                    SELECT id, role_key, can_edit_profile, can_manage_staff, source_type, source_claim_id
                    FROM owner_user_location_access
                    WHERE owner_user_id = :owner_user_id
                      AND core_location_id = :core_location_id
                    LIMIT 1
                    SQL,
                [
                    'owner_user_id' => (int) $ownerUser['id'],
                    'core_location_id' => $claim['canonical_location_id'],
                ],
                [
                    'owner_user_id' => ParameterType::INTEGER,
                    'core_location_id' => ParameterType::INTEGER,
                ],
            );
            if (is_array($existingAccess)) {
                $existingSourceClaimId = $existingAccess['source_claim_id'] !== null ? (int) $existingAccess['source_claim_id'] : null;
                if ($existingSourceClaimId !== null && $existingSourceClaimId !== (int) $claim['claim_id']) {
                    ++$skippedConflictingClaim;

                    continue;
                }

                if (
                    (string) $existingAccess['source_type'] === OwnerUserLocationAccess::SOURCE_APPROVED_CLAIM
                    && $existingSourceClaimId === (int) $claim['claim_id']
                    && (string) $existingAccess['role_key'] === OwnerUserLocationAccess::ROLE_OWNER
                    && (bool) $existingAccess['can_edit_profile'] === true
                    && (bool) $existingAccess['can_manage_staff'] === true
                ) {
                    ++$skippedAlreadySynced;

                    continue;
                }
            }

            $rows[] = [
                'owner_user_id' => (int) $ownerUser['id'],
                'email' => (string) $ownerUser['email'],
                'core_location_id' => $claim['canonical_location_id'],
                'claim_id' => $claim['claim_id'],
                'location_name' => $claim['location_name'],
            ];
        }

        $skipped = [
            'without active owner user' => $skippedMissingOwner,
            'with inactive owner user' => $skippedInactiveOwner,
            'with non-owner local user role' => $skippedNonOwnerRole,
            'already synced' => $skippedAlreadySynced,
            'conflicting existing source claim' => $skippedConflictingClaim,
        ];
        foreach ($skipped as $reason => $count) {
            if ($count > 0) {
                $io->note(sprintf('Skipped %d approved claim(s) %s.', $count, $reason));
            }
        }

        return array_map(static fn (array $row): array => [
            'owner_user_id' => (int) $row['owner_user_id'],
            'email' => (string) $row['email'],
            'core_location_id' => (int) $row['core_location_id'],
            'claim_id' => (int) $row['claim_id'],
            'location_name' => (string) $row['location_name'],
        ], $rows);
    }

    /**
     * @return list<array{claim_id:int, email:string, canonical_location_id:int, location_name:string}>|null
     */
    private function fetchApprovedClaims(?string $email, SymfonyStyle $io): ?array
    {
        $query = ['limit' => 200];
        if ($email !== null) {
            $query['email'] = $email;
        }

        try {
            $response = $this->httpClient->request('GET', rtrim((string) $this->coreApiBaseUrl, '/') . '/api/v1/locals/approved-claims', [
                'headers' => [
                    'Accept' => 'application/json',
                    'X-MiMonchis-Core-Sync-Token' => trim((string) $this->localsCoreSyncToken),
                ],
                'query' => $query,
            ]);
            /** @var array{data?: mixed, errors?: list<string>} $payload */
            $payload = $response->toArray(false);
        } catch (TransportExceptionInterface|\Throwable $exception) {
            $io->error(sprintf('Could not fetch approved claims from Core: %s', $exception->getMessage()));

            return null;
        }

        if ($response->getStatusCode() < 200 || $response->getStatusCode() >= 300) {
            $errors = is_array($payload['errors'] ?? null) ? implode(' ', $payload['errors']) : 'Unexpected Core response.';
            $io->error(sprintf('Core approved claims endpoint returned HTTP %d. %s', $response->getStatusCode(), $errors));

            return null;
        }

        if (!is_array($payload['data'] ?? null)) {
            $io->error('Core approved claims endpoint returned an invalid payload.');

            return null;
        }

        $claims = [];
        foreach ($payload['data'] as $item) {
            if (!is_array($item)) {
                continue;
            }

            $status = is_string($item['status'] ?? null) ? $item['status'] : (is_string($item['claim_status'] ?? null) ? $item['claim_status'] : 'approved');
            if ($status !== 'approved') {
                continue;
            }

            $claimEmail = $this->normalizeEmail($item['email'] ?? null);
            $locationId = (int) ($item['canonical_location_id'] ?? 0);
            $claimId = (int) ($item['claim_id'] ?? 0);
            if ($claimEmail === null || $locationId <= 0 || $claimId <= 0) {
                continue;
            }

            $claims[] = [
                'claim_id' => $claimId,
                'email' => $claimEmail,
                'canonical_location_id' => $locationId,
                'location_name' => is_string($item['location_name'] ?? null) ? $item['location_name'] : '',
            ];
        }

        return $claims;
    }

    /**
     * @param list<array{claim_id:int, email:string, canonical_location_id:int, location_name:string}> $claims
     * @return list<array{claim_id:int, email:string, canonical_location_id:int, location_name:string}>
     */
    private function claimsWithoutAmbiguousDuplicates(array $claims, SymfonyStyle $io): array
    {
        $byOwnerLocation = [];
        foreach ($claims as $claim) {
            $key = sprintf('%s#%d', $claim['email'], $claim['canonical_location_id']);
            $byOwnerLocation[$key][] = $claim;
        }

        $deduped = [];
        $ambiguousCount = 0;
        foreach ($byOwnerLocation as $group) {
            if (count($group) > 1) {
                $ambiguousCount += count($group);

                continue;
            }

            $deduped[] = $group[0];
        }

        if ($ambiguousCount > 0) {
            $io->warning(sprintf(
                'Skipped %d approved claim(s) because Core returned more than one claim for the same owner email and canonical location.',
                $ambiguousCount,
            ));
        }

        return $deduped;
    }

    private function normalizeEmail(mixed $email): ?string
    {
        if (!is_string($email)) {
            return null;
        }

        $email = mb_strtolower(trim($email));

        return $email !== '' ? $email : null;
    }
}
