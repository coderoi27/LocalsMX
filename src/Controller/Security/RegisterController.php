<?php

declare(strict_types=1);

namespace App\Controller\Security;

use App\Entity\Public\PublicUser;
use App\Entity\Public\PublicUserOtp;
use App\Service\Public\OtpCodeFactory;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;

final class RegisterController extends AbstractController
{
    #[Route('/register', name: 'public_register', methods: ['GET', 'POST'])]
    public function __invoke(
        Request $request,
        EntityManagerInterface $entityManager,
        UserPasswordHasherInterface $passwordHasher,
        OtpCodeFactory $otpCodeFactory,
    ): Response {
        if ($request->isMethod('GET')) {
            return $this->render('security/public_register.html.twig');
        }

        $firstName = trim((string) $request->request->get('first_name'));
        $lastName = trim((string) $request->request->get('last_name'));
        $email = trim((string) $request->request->get('email'));
        $password = (string) $request->request->get('password');
        $registrationOrigin = (string) ($request->request->get('registration_origin') ?: 'organic');

        if ($firstName === '' || $lastName === '' || $email === '' || $password === '') {
            return $this->render('security/public_register.html.twig', [
                'error' => 'Todos los campos son obligatorios.',
            ], new Response('', 422));
        }

        $existing = $entityManager->getRepository(PublicUser::class)->findOneBy(['email' => mb_strtolower($email)]);
        if ($existing instanceof PublicUser) {
            return $this->render('security/public_register.html.twig', [
                'error' => 'Ese correo ya esta registrado.',
            ], new Response('', 409));
        }

        $user = (new PublicUser())
            ->setFirstName($firstName)
            ->setLastName($lastName)
            ->setEmail($email)
            ->setRegistrationOrigin($registrationOrigin)
            ->setStatus('pending_verification');

        $user->setPasswordHash($passwordHasher->hashPassword($user, $password));

        $code = $otpCodeFactory->createCode();
        $otp = (new PublicUserOtp())
            ->setPublicUser($user)
            ->setTargetEmail($email)
            ->setPurpose('register_verify')
            ->setOtpHash($otpCodeFactory->hash($code))
            ->setExpiresAt(new \DateTimeImmutable('+10 minutes'))
            ->setCreatedAt(new \DateTimeImmutable());

        $entityManager->persist($user);
        $entityManager->persist($otp);
        $entityManager->flush();

        return $this->render('security/public_verify_otp.html.twig', [
            'email' => mb_strtolower($email),
            'dev_otp_code' => $this->getParameter('kernel.environment') === 'dev' ? $code : null,
        ]);
    }
}
