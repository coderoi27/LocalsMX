<?php

declare(strict_types=1);

namespace App\Controller\Owner;

use App\Entity\OwnerUser;
use App\Entity\OwnerUserLocationAccess;
use App\Service\CoreLocationGateway;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class DashboardController extends AbstractController
{
    #[Route('/dashboard', name: 'locals_dashboard', methods: ['GET'])]
    public function __invoke(EntityManagerInterface $entityManager, CoreLocationGateway $coreLocationGateway): Response
    {
        $user = $this->getUser();
        if (!$user instanceof OwnerUser) {
            throw $this->createAccessDeniedException();
        }

        $staffCount = $entityManager->getRepository(OwnerUser::class)->count([]);
        $accessCount = $entityManager->getRepository(OwnerUserLocationAccess::class)->count(['ownerUser' => $user]);
        $locations = $coreLocationGateway->findOwnedLocations($user);

        return $this->render('owner/dashboard.html.twig', [
            'owner_user' => $user,
            'locations' => $locations,
            'stats' => [
                'staff_count' => $staffCount,
                'access_count' => $accessCount,
                'pending_core_connection' => $accessCount === 0,
            ],
        ]);
    }
}
