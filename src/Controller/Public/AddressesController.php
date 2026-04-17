<?php

declare(strict_types=1);

namespace App\Controller\Public;

use App\Entity\Public\PublicUser;
use App\Entity\Public\PublicUserAddress;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class AddressesController extends AbstractController
{
    #[Route('/api/v1/me/addresses', name: 'public_api_addresses_collection', methods: ['GET', 'POST'])]
    public function collection(Request $request, EntityManagerInterface $entityManager): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof PublicUser) {
            return $this->json(['data' => null, 'meta' => [], 'errors' => ['Unauthenticated.']], 401);
        }

        if ($request->isMethod('GET')) {
            $addresses = $entityManager->getRepository(PublicUserAddress::class)->findBy(['publicUser' => $user], ['id' => 'DESC']);

            $data = array_map(static fn (PublicUserAddress $address): array => [
                'id' => $address->getId(),
                'label' => $address->getLabel(),
                'city' => $address->getCity(),
                'state' => $address->getState(),
                'reference' => $address->getReference(),
                'latitude' => $address->getLatitude(),
                'longitude' => $address->getLongitude(),
                'is_primary' => $address->isPrimary(),
            ], $addresses);

            return $this->json(['data' => $data, 'meta' => [], 'errors' => []]);
        }

        $payload = json_decode($request->getContent(), true);
        if (!is_array($payload) || empty($payload['label'])) {
            return $this->json(['data' => null, 'meta' => [], 'errors' => ['Field "label" is required.']], 422);
        }

        $address = (new PublicUserAddress())
            ->setPublicUser($user)
            ->setLabel((string) $payload['label'])
            ->setCity($payload['city'] ?? null)
            ->setState($payload['state'] ?? null)
            ->setReference($payload['reference'] ?? null)
            ->setLatitude(isset($payload['latitude']) ? (string) $payload['latitude'] : null)
            ->setLongitude(isset($payload['longitude']) ? (string) $payload['longitude'] : null)
            ->setIsPrimary((bool) ($payload['is_primary'] ?? false));

        $entityManager->persist($address);
        $entityManager->flush();

        return $this->json([
            'data' => [
                'id' => $address->getId(),
                'label' => $address->getLabel(),
            ],
            'meta' => [],
            'errors' => [],
        ], 201);
    }
}
