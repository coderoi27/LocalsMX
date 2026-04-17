<?php

declare(strict_types=1);

namespace App\Controller\Security;

use App\Entity\Public\PublicUser;
use App\Entity\Public\PublicUserOtp;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class VerifyOtpController extends AbstractController
{
    #[Route('/verify-otp', name: 'public_verify_otp', methods: ['POST'])]
    public function __invoke(Request $request, EntityManagerInterface $entityManager): Response
    {
        $email = mb_strtolower(trim((string) $request->request->get('email')));
        $code = trim((string) $request->request->get('code'));

        $otp = $entityManager->getRepository(PublicUserOtp::class)->findOneBy(
            ['targetEmail' => $email, 'purpose' => 'register_verify'],
            ['id' => 'DESC']
        );

        if (!$otp instanceof PublicUserOtp || $otp->getConsumedAt() !== null || $otp->isExpired()) {
            return $this->render('security/public_verify_otp.html.twig', [
                'email' => $email,
                'error' => 'El codigo no es valido o ya expiro.',
            ], new Response('', 422));
        }

        $otp->increaseAttempts();
        if ($otp->getAttempts() > 5 || !$otp->verify($code)) {
            $entityManager->flush();

            return $this->render('security/public_verify_otp.html.twig', [
                'email' => $email,
                'error' => 'Codigo OTP incorrecto.',
            ], new Response('', 422));
        }

        $user = $entityManager->getRepository(PublicUser::class)->findOneBy(['email' => $email]);
        if ($user instanceof PublicUser) {
            $user
                ->setStatus('active')
                ->setEmailVerifiedAt(new \DateTimeImmutable());
        }

        $otp->consume();
        $entityManager->flush();

        $this->addFlash('success', 'Tu correo fue verificado. Ya puedes iniciar sesion.');

        return $this->redirectToRoute('public_login');
    }
}
