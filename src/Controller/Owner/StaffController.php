<?php

declare(strict_types=1);

namespace App\Controller\Owner;

use App\Entity\OwnerUser;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;

final class StaffController extends AbstractController
{
    #[Route('/staff', name: 'locals_staff_index', methods: ['GET', 'POST'])]
    public function index(
        Request $request,
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher,
    ): Response {
        $currentUser = $this->currentOwnerUser();

        if ($request->isMethod('POST')) {
            return $this->createStaffUser($request, $entityManager, $passwordHasher);
        }

        return $this->render('owner/staff.html.twig', [
            'owner_user' => $currentUser,
            'staff_users' => $entityManager->getRepository(OwnerUser::class)->findBy([], ['id' => 'ASC']),
            'roles' => [
                OwnerUser::ROLE_MANAGER => 'Encargado',
                OwnerUser::ROLE_STAFF => 'Staff',
            ],
        ]);
    }

    #[Route('/staff/{id}/status', name: 'locals_staff_status', methods: ['POST'])]
    public function status(OwnerUser $staffUser, Request $request, EntityManagerInterface $entityManager): RedirectResponse
    {
        $this->currentOwnerUser();

        $status = $request->request->getString('status', OwnerUser::STATUS_ACTIVE);
        if (!in_array($status, [OwnerUser::STATUS_ACTIVE, OwnerUser::STATUS_SUSPENDED], true)) {
            $this->addFlash('error', 'Estatus de staff no válido.');

            return $this->redirectToRoute('locals_staff_index');
        }

        $staffUser->setStatus($status);
        $entityManager->flush();

        $this->addFlash('success', 'Staff actualizado.');

        return $this->redirectToRoute('locals_staff_index');
    }

    private function createStaffUser(
        Request $request,
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher,
    ): RedirectResponse {
        $fullName = trim((string) $request->request->get('full_name'));
        $email = trim((string) $request->request->get('email'));
        $roleKey = $request->request->getString('role_key', OwnerUser::ROLE_STAFF);
        $password = (string) $request->request->get('password');

        if ($fullName === '' || $email === '' || $password === '') {
            $this->addFlash('error', 'Nombre, correo y contraseña temporal son obligatorios.');

            return $this->redirectToRoute('locals_staff_index');
        }

        if (!in_array($roleKey, [OwnerUser::ROLE_MANAGER, OwnerUser::ROLE_STAFF], true)) {
            $this->addFlash('error', 'Rol de staff no válido.');

            return $this->redirectToRoute('locals_staff_index');
        }

        if ($entityManager->getRepository(OwnerUser::class)->findOneBy(['email' => mb_strtolower($email)]) instanceof OwnerUser) {
            $this->addFlash('error', 'Ese correo ya tiene acceso al panel.');

            return $this->redirectToRoute('locals_staff_index');
        }

        $staffUser = (new OwnerUser())
            ->setFullName($fullName)
            ->setEmail($email)
            ->setRoleKey($roleKey)
            ->setStatus(OwnerUser::STATUS_ACTIVE)
            ->setRegistrationOrigin('staff_invite');

        $staffUser->setPasswordHash($passwordHasher->hashPassword($staffUser, $password));

        $entityManager->persist($staffUser);
        $entityManager->flush();

        $this->addFlash('success', 'Usuario de staff creado.');

        return $this->redirectToRoute('locals_staff_index');
    }

    private function currentOwnerUser(): OwnerUser
    {
        $user = $this->getUser();
        if (!$user instanceof OwnerUser) {
            throw $this->createAccessDeniedException();
        }

        if (!in_array(OwnerUser::ROLE_OWNER, [$user->getRoleKey()], true) && !$this->isGranted('ROLE_OWNER_MANAGER')) {
            throw $this->createAccessDeniedException();
        }

        return $user;
    }
}
