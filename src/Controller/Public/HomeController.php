<?php

declare(strict_types=1);

namespace App\Controller\Public;

use App\Entity\Public\PublicUser;
use App\Entity\Public\PublicUserAddress;
use App\Entity\Public\PublicUserFavoritePlace;
use App\Service\Public\CoreFeedClient;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\ParameterBag\ParameterBagInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class HomeController extends AbstractController
{
    #[Route('/', name: 'public_home', methods: ['GET'])]
    public function __invoke(
        Request $request,
        CoreFeedClient $coreFeedClient,
        EntityManagerInterface $entityManager,
        ParameterBagInterface $parameterBag,
    ): Response
    {
        if ((bool) $parameterBag->get('app.alpha_invite_required') && $request->getSession()->get('alpha_access_granted') !== true) {
            return $this->render('public/alpha_request.html.twig', [
                'logo_url' => '/images/branding/logo-simple-vertical.png',
            ]);
        }

        $lat = $request->query->get('lat');
        $lng = $request->query->get('lng');

        $feed = $coreFeedClient->fetchLocations(
            is_numeric((string) $lat) ? (float) $lat : null,
            is_numeric((string) $lng) ? (float) $lng : null,
        );

        $user = $this->getUser();
        $favoriteLocationIds = [];
        $savedAddresses = [];

        if ($user instanceof PublicUser) {
            $favorites = $entityManager->getRepository(PublicUserFavoritePlace::class)->findBy([
                'publicUser' => $user,
            ]);

            $favoriteLocationIds = array_values(array_map(
                static fn (PublicUserFavoritePlace $favorite): int => $favorite->getLocationId(),
                $favorites,
            ));

            $addresses = $entityManager->getRepository(PublicUserAddress::class)->findBy(
                ['publicUser' => $user],
                ['id' => 'DESC'],
            );

            $savedAddresses = array_map(static fn (PublicUserAddress $address): array => [
                'id' => $address->getId(),
                'label' => $address->getLabel(),
                'city' => $address->getCity(),
                'state' => $address->getState(),
                'reference' => $address->getReference(),
                'latitude' => $address->getLatitude(),
                'longitude' => $address->getLongitude(),
                'is_primary' => $address->isPrimary(),
            ], $addresses);
        }

        return $this->render('public/home.html.twig', [
            'locations' => $feed['data'],
            'feed_errors' => $feed['errors'],
            'query_lat' => $lat,
            'query_lng' => $lng,
            'current_user' => $user instanceof PublicUser ? $user : null,
            'favorite_location_ids' => $favoriteLocationIds,
            'saved_addresses' => $savedAddresses,
            'google_maps_api_key' => (string) $parameterBag->get('app.google_maps_api_key'),
            'walkthrough_enabled' => (bool) $parameterBag->get('app.walkthrough_enabled'),
            'logo_url' => '/images/branding/logo-simple-vertical.png',
        ]);
    }
}
