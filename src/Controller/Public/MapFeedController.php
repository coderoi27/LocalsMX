<?php

declare(strict_types=1);

namespace App\Controller\Public;

use App\Service\Public\CoreFeedClient;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class MapFeedController extends AbstractController
{
    #[Route('/api/v1/map-feed', name: 'public_api_map_feed', methods: ['GET'])]
    public function __invoke(Request $request, CoreFeedClient $coreFeedClient): JsonResponse
    {
        $lat = $request->query->get('lat');
        $lng = $request->query->get('lng');

        $feed = $coreFeedClient->fetchLocations(
            is_numeric((string) $lat) ? (float) $lat : null,
            is_numeric((string) $lng) ? (float) $lng : null,
        );

        $statusCode = $feed['errors'] !== [] ? 502 : 200;

        return $this->json($feed, $statusCode);
    }
}
