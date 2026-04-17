<?php

declare(strict_types=1);

namespace App\Service\Public;

use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class CoreFeedClient
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly ?string $coreApiBaseUrl,
    ) {
    }

    /**
     * @return array{data: array<int, array<string, mixed>>, meta: array<string, mixed>, errors: array<int, string>}
     */
    public function fetchLocations(?float $lat = null, ?float $lng = null): array
    {
        if ($this->coreApiBaseUrl === null || trim($this->coreApiBaseUrl) === '') {
            return [
                'data' => [],
                'meta' => [],
                'errors' => ['CORE_API_BASE_URL no esta configurado en Public-MiMonchisMX.'],
            ];
        }

        $query = array_filter([
            'lat' => $lat,
            'lng' => $lng,
        ], static fn (mixed $value): bool => $value !== null && $value !== '');

        try {
            $response = $this->httpClient->request('GET', rtrim($this->coreApiBaseUrl, '/') . '/api/v1/locations/feed', [
                'query' => $query,
            ]);

            /** @var array{data?: array<int, array<string, mixed>>, meta?: array<string, mixed>, errors?: array<int, string>} $payload */
            $payload = $response->toArray(false);

            return [
                'data' => $payload['data'] ?? [],
                'meta' => $payload['meta'] ?? [],
                'errors' => $payload['errors'] ?? [],
            ];
        } catch (TransportExceptionInterface|\Throwable $exception) {
            return [
                'data' => [],
                'meta' => [],
                'errors' => [$exception->getMessage()],
            ];
        }
    }
}
