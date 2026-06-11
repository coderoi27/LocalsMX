<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\OwnerUser;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;

final readonly class CoreLocationGateway
{
    public function __construct(private Connection $connection)
    {
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findOwnedLocations(OwnerUser $ownerUser): array
    {
        if ($ownerUser->getId() === null) {
            return [];
        }

        $rows = $this->connection->fetchAllAssociative(
            <<<'SQL'
                SELECT
                    access.core_location_id,
                    access.role_key AS access_role,
                    access.can_edit_profile,
                    access.can_manage_staff,
                    location.name,
                    location.slug,
                    location.status,
                    location.publication_state,
                    location.source_type,
                    location.phone_e164,
                    location.whatsapp_e164,
                    location.whatsapp_enabled,
                    location.short_description,
                    service_profile.offers_delivery,
                    service_profile.offers_takeaway,
                    service_profile.offers_dine_in,
                    service_profile.delivery_notes,
                    service_profile.service_notes,
                    category.name AS category_name,
                    address.neighborhood,
                    address.city,
                    address.state
                FROM owner_user_location_access access
                INNER JOIN merchant_locations location ON location.id = access.core_location_id
                LEFT JOIN location_service_profiles service_profile ON service_profile.location_id = location.id
                LEFT JOIN location_categories category ON category.id = location.primary_category_id
                LEFT JOIN place_addresses address ON address.location_id = location.id AND address.is_primary = 1
                WHERE access.owner_user_id = :owner_user_id
                ORDER BY location.name ASC
                SQL,
            ['owner_user_id' => $ownerUser->getId()],
            ['owner_user_id' => ParameterType::INTEGER],
        );

        return array_map([$this, 'normalizeLocationRow'], $rows);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findEditableLocation(OwnerUser $ownerUser, int $coreLocationId): ?array
    {
        if ($ownerUser->getId() === null) {
            return null;
        }

        $row = $this->connection->fetchAssociative(
            <<<'SQL'
                SELECT
                    access.core_location_id,
                    access.role_key AS access_role,
                    access.can_edit_profile,
                    access.can_manage_staff,
                    location.name,
                    location.slug,
                    location.location_type,
                    location.status,
                    location.publication_state,
                    location.source_type,
                    location.phone_e164,
                    location.whatsapp_e164,
                    location.whatsapp_enabled,
                    location.short_description,
                    location.gem_status,
                    location.external_source_key,
                    service_profile.offers_delivery,
                    service_profile.offers_takeaway,
                    service_profile.offers_dine_in,
                    service_profile.delivery_notes,
                    service_profile.service_notes,
                    category.name AS category_name,
                    address.label AS address_label,
                    address.neighborhood,
                    address.city,
                    address.state,
                    address.street,
                    address.ext_number,
                    address.zip_code,
                    address.reference
                FROM owner_user_location_access access
                INNER JOIN merchant_locations location ON location.id = access.core_location_id
                LEFT JOIN location_service_profiles service_profile ON service_profile.location_id = location.id
                LEFT JOIN location_categories category ON category.id = location.primary_category_id
                LEFT JOIN place_addresses address ON address.location_id = location.id AND address.is_primary = 1
                WHERE access.owner_user_id = :owner_user_id
                  AND access.core_location_id = :core_location_id
                LIMIT 1
                SQL,
            [
                'owner_user_id' => $ownerUser->getId(),
                'core_location_id' => $coreLocationId,
            ],
            [
                'owner_user_id' => ParameterType::INTEGER,
                'core_location_id' => ParameterType::INTEGER,
            ],
        );

        if (!is_array($row)) {
            return null;
        }

        $row = $this->normalizeLocationRow($row);
        $row['opening_hours'] = $this->findOpeningHours($coreLocationId);
        $row['opening_exceptions'] = $this->findOpeningExceptions($coreLocationId);
        $row['media_items'] = $this->findMediaItems($coreLocationId);
        $row['social_links'] = $this->findSocialLinks($coreLocationId);

        return $row;
    }

    /**
     * @param array{name:string, phone_e164:string|null, whatsapp_e164:string|null, whatsapp_enabled:bool, short_description:string|null, offers_delivery:bool, offers_takeaway:bool, offers_dine_in:bool, delivery_notes:string|null, service_notes:string|null, opening_hours:array<int, array{is_closed:bool, opens_at:string|null, closes_at:string|null}>, opening_exceptions:list<array{exception_date:string, label:string|null, is_closed:bool, opens_at:string|null, closes_at:string|null}>, media_items:list<array{media_type:string, url:string, title:string|null, sort_order:int, is_primary:bool}>, social_links:list<array{platform:string, url:string, label:string|null}>} $data
     */
    public function updateBasicProfile(OwnerUser $ownerUser, int $coreLocationId, array $data): bool
    {
        $location = $this->findEditableLocation($ownerUser, $coreLocationId);
        if ($location === null || $location['can_edit_profile'] !== true) {
            return false;
        }

        $affectedRows = $this->connection->executeStatement(
            <<<'SQL'
                UPDATE merchant_locations
                SET
                    name = :name,
                    phone_e164 = :phone_e164,
                    whatsapp_e164 = :whatsapp_e164,
                    whatsapp_enabled = :whatsapp_enabled,
                    short_description = :short_description,
                    updated_at = :updated_at
                WHERE id = :core_location_id
                SQL,
            [
                'name' => $data['name'],
                'phone_e164' => $data['phone_e164'],
                'whatsapp_e164' => $data['whatsapp_e164'],
                'whatsapp_enabled' => $data['whatsapp_enabled'],
                'short_description' => $data['short_description'],
                'updated_at' => (new \DateTimeImmutable())->format('Y-m-d H:i:s'),
                'core_location_id' => $coreLocationId,
            ],
            [
                'whatsapp_enabled' => ParameterType::BOOLEAN,
                'core_location_id' => ParameterType::INTEGER,
            ],
        );
        $this->connection->executeStatement(
            <<<'SQL'
                INSERT INTO location_service_profiles (
                    location_id,
                    offers_delivery,
                    offers_takeaway,
                    offers_dine_in,
                    delivery_notes,
                    service_notes,
                    created_at,
                    updated_at
                ) VALUES (
                    :core_location_id,
                    :offers_delivery,
                    :offers_takeaway,
                    :offers_dine_in,
                    :delivery_notes,
                    :service_notes,
                    :updated_at,
                    :updated_at
                )
                ON DUPLICATE KEY UPDATE
                    offers_delivery = VALUES(offers_delivery),
                    offers_takeaway = VALUES(offers_takeaway),
                    offers_dine_in = VALUES(offers_dine_in),
                    delivery_notes = VALUES(delivery_notes),
                    service_notes = VALUES(service_notes),
                    updated_at = VALUES(updated_at)
                SQL,
            [
                'core_location_id' => $coreLocationId,
                'offers_delivery' => $data['offers_delivery'],
                'offers_takeaway' => $data['offers_takeaway'],
                'offers_dine_in' => $data['offers_dine_in'],
                'delivery_notes' => $data['delivery_notes'],
                'service_notes' => $data['service_notes'],
                'updated_at' => (new \DateTimeImmutable())->format('Y-m-d H:i:s'),
            ],
            [
                'core_location_id' => ParameterType::INTEGER,
                'offers_delivery' => ParameterType::BOOLEAN,
                'offers_takeaway' => ParameterType::BOOLEAN,
                'offers_dine_in' => ParameterType::BOOLEAN,
            ],
        );
        $this->replaceOpeningHours($coreLocationId, $data['opening_hours']);
        $this->replaceOpeningExceptions($coreLocationId, $data['opening_exceptions']);
        $this->replaceMediaItems($coreLocationId, $data['media_items']);
        $this->replaceSocialLinks($coreLocationId, $data['social_links']);

        return $affectedRows >= 0;
    }

    /**
     * @return array<int, array{is_closed: bool, opens_at: string|null, closes_at: string|null}>
     */
    private function findOpeningHours(int $coreLocationId): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT day_of_week, opens_at, closes_at, is_closed FROM location_opening_hours WHERE location_id = :core_location_id ORDER BY day_of_week ASC',
            ['core_location_id' => $coreLocationId],
            ['core_location_id' => ParameterType::INTEGER],
        );

        $hours = [];
        foreach ($rows as $row) {
            $dayOfWeek = (int) $row['day_of_week'];
            $hours[$dayOfWeek] = [
                'is_closed' => (bool) $row['is_closed'],
                'opens_at' => $this->normalizeTimeValue($row['opens_at'] ?? null),
                'closes_at' => $this->normalizeTimeValue($row['closes_at'] ?? null),
            ];
        }

        return $hours;
    }

    /**
     * @return list<array{exception_date:string, label:string|null, is_closed:bool, opens_at:string|null, closes_at:string|null}>
     */
    private function findOpeningExceptions(int $coreLocationId): array
    {
        $rows = $this->connection->fetchAllAssociative(
            <<<'SQL'
                SELECT exception_date, label, opens_at, closes_at, is_closed
                FROM location_opening_exceptions
                WHERE location_id = :core_location_id
                ORDER BY exception_date ASC
                LIMIT 12
                SQL,
            ['core_location_id' => $coreLocationId],
            ['core_location_id' => ParameterType::INTEGER],
        );

        return array_map(fn (array $row): array => [
            'exception_date' => $this->normalizeDateValue($row['exception_date'] ?? null),
            'label' => is_string($row['label'] ?? null) ? $row['label'] : null,
            'is_closed' => (bool) $row['is_closed'],
            'opens_at' => $this->normalizeTimeValue($row['opens_at'] ?? null),
            'closes_at' => $this->normalizeTimeValue($row['closes_at'] ?? null),
        ], $rows);
    }

    /**
     * @return list<array{media_type:string, url:string, title:string|null, sort_order:int, is_primary:bool}>
     */
    private function findMediaItems(int $coreLocationId): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT media_type, url, title, sort_order, is_primary FROM location_media_items WHERE location_id = :core_location_id AND is_active = 1 ORDER BY sort_order ASC, id ASC',
            ['core_location_id' => $coreLocationId],
            ['core_location_id' => ParameterType::INTEGER],
        );

        return array_map(static fn (array $row): array => [
            'media_type' => (string) $row['media_type'],
            'url' => (string) $row['url'],
            'title' => is_string($row['title'] ?? null) ? $row['title'] : null,
            'sort_order' => (int) $row['sort_order'],
            'is_primary' => (bool) $row['is_primary'],
        ], $rows);
    }

    /**
     * @return list<array{platform:string, url:string, label:string|null}>
     */
    private function findSocialLinks(int $coreLocationId): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT platform, url, label FROM location_social_links WHERE location_id = :core_location_id AND is_active = 1 ORDER BY sort_order ASC, id ASC',
            ['core_location_id' => $coreLocationId],
            ['core_location_id' => ParameterType::INTEGER],
        );

        return array_map(static fn (array $row): array => [
            'platform' => (string) $row['platform'],
            'url' => (string) $row['url'],
            'label' => is_string($row['label'] ?? null) ? $row['label'] : null,
        ], $rows);
    }

    /**
     * @param array<int, array{is_closed:bool, opens_at:string|null, closes_at:string|null}> $openingHours
     */
    private function replaceOpeningHours(int $coreLocationId, array $openingHours): void
    {
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        foreach ($openingHours as $dayOfWeek => $hours) {
            $this->connection->executeStatement(
                <<<'SQL'
                    INSERT INTO location_opening_hours (
                        location_id,
                        day_of_week,
                        opens_at,
                        closes_at,
                        is_closed,
                        created_at,
                        updated_at
                    ) VALUES (
                        :core_location_id,
                        :day_of_week,
                        :opens_at,
                        :closes_at,
                        :is_closed,
                        :updated_at,
                        :updated_at
                    )
                    ON DUPLICATE KEY UPDATE
                        opens_at = VALUES(opens_at),
                        closes_at = VALUES(closes_at),
                        is_closed = VALUES(is_closed),
                        updated_at = VALUES(updated_at)
                    SQL,
                [
                    'core_location_id' => $coreLocationId,
                    'day_of_week' => $dayOfWeek,
                    'opens_at' => $hours['is_closed'] ? null : $hours['opens_at'],
                    'closes_at' => $hours['is_closed'] ? null : $hours['closes_at'],
                    'is_closed' => $hours['is_closed'],
                    'updated_at' => $now,
                ],
                [
                    'core_location_id' => ParameterType::INTEGER,
                    'day_of_week' => ParameterType::INTEGER,
                    'is_closed' => ParameterType::BOOLEAN,
                ],
            );
        }
    }

    /**
     * @param list<array{exception_date:string, label:string|null, is_closed:bool, opens_at:string|null, closes_at:string|null}> $openingExceptions
     */
    private function replaceOpeningExceptions(int $coreLocationId, array $openingExceptions): void
    {
        $this->connection->executeStatement(
            'DELETE FROM location_opening_exceptions WHERE location_id = :core_location_id',
            ['core_location_id' => $coreLocationId],
            ['core_location_id' => ParameterType::INTEGER],
        );

        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        foreach ($openingExceptions as $exception) {
            $this->connection->executeStatement(
                <<<'SQL'
                    INSERT INTO location_opening_exceptions (
                        location_id,
                        exception_date,
                        label,
                        opens_at,
                        closes_at,
                        is_closed,
                        created_at,
                        updated_at
                    ) VALUES (
                        :core_location_id,
                        :exception_date,
                        :label,
                        :opens_at,
                        :closes_at,
                        :is_closed,
                        :updated_at,
                        :updated_at
                    )
                    SQL,
                [
                    'core_location_id' => $coreLocationId,
                    'exception_date' => $exception['exception_date'],
                    'label' => $exception['label'],
                    'opens_at' => $exception['is_closed'] ? null : $exception['opens_at'],
                    'closes_at' => $exception['is_closed'] ? null : $exception['closes_at'],
                    'is_closed' => $exception['is_closed'],
                    'updated_at' => $now,
                ],
                [
                    'core_location_id' => ParameterType::INTEGER,
                    'is_closed' => ParameterType::BOOLEAN,
                ],
            );
        }
    }

    /**
     * @param list<array{media_type:string, url:string, title:string|null, sort_order:int, is_primary:bool}> $mediaItems
     */
    private function replaceMediaItems(int $coreLocationId, array $mediaItems): void
    {
        $this->connection->executeStatement(
            'DELETE FROM location_media_items WHERE location_id = :core_location_id',
            ['core_location_id' => $coreLocationId],
            ['core_location_id' => ParameterType::INTEGER],
        );

        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        foreach ($mediaItems as $item) {
            $this->connection->executeStatement(
                <<<'SQL'
                    INSERT INTO location_media_items (
                        location_id,
                        media_type,
                        url,
                        title,
                        alt_text,
                        sort_order,
                        is_primary,
                        is_active,
                        created_at,
                        updated_at
                    ) VALUES (
                        :core_location_id,
                        :media_type,
                        :url,
                        :title,
                        :title,
                        :sort_order,
                        :is_primary,
                        1,
                        :updated_at,
                        :updated_at
                    )
                    SQL,
                [
                    'core_location_id' => $coreLocationId,
                    'media_type' => $item['media_type'],
                    'url' => $item['url'],
                    'title' => $item['title'],
                    'sort_order' => $item['sort_order'],
                    'is_primary' => $item['is_primary'],
                    'updated_at' => $now,
                ],
                [
                    'core_location_id' => ParameterType::INTEGER,
                    'sort_order' => ParameterType::INTEGER,
                    'is_primary' => ParameterType::BOOLEAN,
                ],
            );
        }
    }

    /**
     * @param list<array{platform:string, url:string, label:string|null}> $socialLinks
     */
    private function replaceSocialLinks(int $coreLocationId, array $socialLinks): void
    {
        $this->connection->executeStatement(
            'DELETE FROM location_social_links WHERE location_id = :core_location_id',
            ['core_location_id' => $coreLocationId],
            ['core_location_id' => ParameterType::INTEGER],
        );

        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        foreach ($socialLinks as $index => $link) {
            $this->connection->executeStatement(
                <<<'SQL'
                    INSERT INTO location_social_links (
                        location_id,
                        platform,
                        url,
                        label,
                        sort_order,
                        is_active,
                        created_at,
                        updated_at
                    ) VALUES (
                        :core_location_id,
                        :platform,
                        :url,
                        :label,
                        :sort_order,
                        1,
                        :updated_at,
                        :updated_at
                    )
                    SQL,
                [
                    'core_location_id' => $coreLocationId,
                    'platform' => $link['platform'],
                    'url' => $link['url'],
                    'label' => $link['label'],
                    'sort_order' => $index + 1,
                    'updated_at' => $now,
                ],
                [
                    'core_location_id' => ParameterType::INTEGER,
                    'sort_order' => ParameterType::INTEGER,
                ],
            );
        }
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function normalizeLocationRow(array $row): array
    {
        $row['core_location_id'] = (int) $row['core_location_id'];
        $row['can_edit_profile'] = (bool) $row['can_edit_profile'];
        $row['can_manage_staff'] = (bool) $row['can_manage_staff'];
        $row['whatsapp_enabled'] = (bool) ($row['whatsapp_enabled'] ?? false);
        $row['offers_delivery'] = (bool) ($row['offers_delivery'] ?? false);
        $row['offers_takeaway'] = (bool) ($row['offers_takeaway'] ?? false);
        $row['offers_dine_in'] = array_key_exists('offers_dine_in', $row) && $row['offers_dine_in'] !== null ? (bool) $row['offers_dine_in'] : true;

        return $row;
    }

    private function normalizeTimeValue(mixed $value): ?string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('H:i');
        }

        if (is_string($value) && $value !== '') {
            return substr($value, 0, 5);
        }

        return null;
    }

    private function normalizeDateValue(mixed $value): string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        if (is_string($value) && $value !== '') {
            return substr($value, 0, 10);
        }

        return '';
    }
}
