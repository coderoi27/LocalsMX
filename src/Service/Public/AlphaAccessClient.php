<?php

declare(strict_types=1);

namespace App\Service\Public;

use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class AlphaAccessClient
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly ?string $coreApiBaseUrl,
    ) {
    }

    /**
     * @return array{valid: bool, errors: array<int, string>, invitation: array<string, mixed>|null}
     */
    public function validateAccessCode(string $accessCode): array
    {
        $trimmedCode = trim($accessCode);
        if ($trimmedCode === '') {
            return [
                'valid' => false,
                'errors' => ['Captura tu token o codigo de invitacion.'],
                'invitation' => null,
            ];
        }

        if ($this->coreApiBaseUrl === null || trim($this->coreApiBaseUrl) === '') {
            return [
                'valid' => false,
                'errors' => ['CORE_API_BASE_URL no esta configurado en Public-MiMonchisMX.'],
                'invitation' => null,
            ];
        }

        try {
            $response = $this->httpClient->request('POST', rtrim($this->coreApiBaseUrl, '/') . '/api/v1/public-invitations/validate', [
                'headers' => [
                    'Accept' => 'application/json',
                ],
                'json' => ['access_code' => $trimmedCode],
            ]);

            $contentType = $response->getHeaders(false)['content-type'][0] ?? '';
            if (!str_contains($contentType, 'application/json')) {
                return [
                    'valid' => false,
                    'errors' => [sprintf('Admin/core respondio con un formato no JSON (%s).', $contentType !== '' ? $contentType : 'desconocido')],
                    'invitation' => null,
                ];
            }

            /** @var array{data?: array<string, mixed>|null, errors?: array<int, string>} $payload */
            $payload = $response->toArray(false);

            return [
                'valid' => $response->getStatusCode() >= 200 && $response->getStatusCode() < 300 && ($payload['errors'] ?? []) === [],
                'errors' => $payload['errors'] ?? [],
                'invitation' => is_array($payload['data'] ?? null) ? $payload['data'] : null,
            ];
        } catch (TransportExceptionInterface|\Throwable $exception) {
            return [
                'valid' => false,
                'errors' => [$exception->getMessage()],
                'invitation' => null,
            ];
        }
    }
}
