<?php

declare(strict_types=1);

namespace App\Controller\Public;

use App\Entity\Public\PublicUser;
use App\Entity\Public\PublicUserFavoritePlace;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class FavoritePlacesController extends AbstractController
{
    #[Route('/api/v1/me/favorites', name: 'public_api_favorites_collection', methods: ['GET', 'POST'])]
    public function collection(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof PublicUser) {
            return $this->json(['data' => null, 'meta' => [], 'errors' => ['Unauthenticated.']], 401);
        }

        if ($request->isMethod('GET')) {
            $favorites = $entityManager->getRepository(PublicUserFavoritePlace::class)->findBy(['publicUser' => $user], ['id' => 'DESC']);

            $data = array_map(static fn (PublicUserFavoritePlace $favorite): array => [
                'location_id' => $favorite->getLocationId(),
                'created_at' => $favorite->getCreatedAt()->format(DATE_ATOM),
            ], $favorites);

            return $this->json(['data' => $data, 'meta' => [], 'errors' => []]);
        }

        $payload = json_decode($request->getContent(), true);
        $locationId = is_array($payload) ? (int) ($payload['location_id'] ?? 0) : 0;
        if ($locationId <= 0) {
            return $this->json(['data' => null, 'meta' => [], 'errors' => ['Field "location_id" is required.']], 422);
        }

        $existing = $entityManager->getRepository(PublicUserFavoritePlace::class)->findOneBy([
            'publicUser' => $user,
            'locationId' => $locationId,
        ]);

        if (!$existing instanceof PublicUserFavoritePlace) {
            $favorite = (new PublicUserFavoritePlace())
                ->setPublicUser($user)
                ->setLocationId($locationId);

            $entityManager->persist($favorite);
            $entityManager->flush();
        }

        return $this->json([
            'data' => ['location_id' => $locationId],
            'meta' => [],
            'errors' => [],
        ], 201);
    }

    #[Route('/api/v1/me/favorites/{locationId}', name: 'public_api_favorites_delete', methods: ['DELETE'])]
    public function delete(int $locationId, EntityManagerInterface $entityManager): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof PublicUser) {
            return $this->json(['data' => null, 'meta' => [], 'errors' => ['Unauthenticated.']], 401);
        }

        $favorite = $entityManager->getRepository(PublicUserFavoritePlace::class)->findOneBy([
            'publicUser' => $user,
            'locationId' => $locationId,
        ]);

        if ($favorite instanceof PublicUserFavoritePlace) {
            $entityManager->remove($favorite);
            $entityManager->flush();
        }

        return $this->json(['data' => ['location_id' => $locationId], 'meta' => [], 'errors' => []]);
    }
}
