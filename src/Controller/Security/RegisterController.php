<?php

declare(strict_types=1);

namespace App\Controller\Security;

use App\Entity\OwnerUser;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;

final class RegisterController extends AbstractController
{
    #[Route('/register', name: 'locals_register', methods: ['GET', 'POST'])]
    public function __invoke(
        Request $request,
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher,
    ): Response {
        if ($this->getUser() !== null) {
            return $this->redirectToRoute('locals_dashboard');
        }

        if ($request->isMethod('GET')) {
            return $this->render('security/register.html.twig');
        }

        $fullName = trim((string) $request->request->get('full_name'));
        $email = trim((string) $request->request->get('email'));
        $password = (string) $request->request->get('password');

        if ($fullName === '' || $email === '' || $password === '') {
            return $this->render('security/register.html.twig', [
                'error' => 'Nombre, correo y contraseña son obligatorios.',
            ], new Response('', 422));
        }

        if ($entityManager->getRepository(OwnerUser::class)->findOneBy(['email' => mb_strtolower($email)]) instanceof OwnerUser) {
            return $this->render('security/register.html.twig', [
                'error' => 'Ese correo ya tiene acceso al panel de locales.',
            ], new Response('', 409));
        }

        $ownerUser = (new OwnerUser())
            ->setFullName($fullName)
            ->setEmail($email)
            ->setRoleKey(OwnerUser::ROLE_OWNER)
            ->setStatus(OwnerUser::STATUS_ACTIVE)
            ->setRegistrationOrigin('organic');

        $ownerUser->setPasswordHash($passwordHasher->hashPassword($ownerUser, $password));

        $entityManager->persist($ownerUser);
        $entityManager->flush();

        $this->addFlash('success', 'Cuenta creada. Ingresa para comenzar a configurar tu local.');

        return $this->redirectToRoute('locals_login');
    }
}
