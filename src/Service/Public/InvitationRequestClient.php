<?php

declare(strict_types=1);

namespace App\Service\Public;

use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class InvitationRequestClient
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly ?string $coreApiBaseUrl,
    ) {
    }

    /**
     * @return array{ok: bool, errors: array<int, string>, invitation_url: string|null, expires_at: string|null}
     */
    public function requestInvitation(string $email, int $expiresInDays = 7): array
    {
        if ($this->coreApiBaseUrl === null || trim($this->coreApiBaseUrl) === '') {
            return [
                'ok' => false,
                'errors' => ['CORE_API_BASE_URL no esta configurado en Public-MiMonchisMX.'],
                'invitation_url' => null,
                'expires_at' => null,
            ];
        }

        try {
            $response = $this->httpClient->request('POST', rtrim($this->coreApiBaseUrl, '/') . '/api/v1/public-invitations', [
                'headers' => [
                    'Accept' => 'application/json',
                ],
                'json' => [
                    'email' => $email,
                    'campaign_name' => 'Alpha privada evento',
                    'campaign_type' => 'alpha_private',
                    'message_subject' => 'Tu acceso alpha a Mi Monchis MX',
                    'message_body' => 'Acceso exclusivo a la demo alpha.',
                    'expires_in_days' => $expiresInDays,
                ],
            ]);

            $contentType = $response->getHeaders(false)['content-type'][0] ?? '';
            if (!str_contains($contentType, 'application/json')) {
                return [
                    'ok' => false,
                    'errors' => [sprintf('Admin/core respondio con un formato no JSON (%s).', $contentType !== '' ? $contentType : 'desconocido')],
                    'invitation_url' => null,
                    'expires_at' => null,
                ];
            }

            /** @var array{data?: array<string, mixed>|null, errors?: array<int, string>} $payload */
            $payload = $response->toArray(false);

            return [
                'ok' => $response->getStatusCode() >= 200 && $response->getStatusCode() < 300 && ($payload['errors'] ?? []) === [],
                'errors' => $payload['errors'] ?? [],
                'invitation_url' => is_array($payload['data'] ?? null) ? (string) ($payload['data']['invitation_url'] ?? '') : null,
                'expires_at' => is_array($payload['data'] ?? null) ? (string) ($payload['data']['expires_at'] ?? '') : null,
            ];
        } catch (TransportExceptionInterface|\Throwable $exception) {
            return [
                'ok' => false,
                'errors' => [$exception->getMessage()],
                'invitation_url' => null,
                'expires_at' => null,
            ];
        }
    }
}
