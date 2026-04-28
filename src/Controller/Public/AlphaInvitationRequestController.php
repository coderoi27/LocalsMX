<?php

declare(strict_types=1);

namespace App\Controller\Public;

use App\Entity\Public\PublicInterestLead;
use App\Entity\Public\PublicUser;
use App\Service\Public\InvitationRequestClient;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\ParameterBag\ParameterBagInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Symfony\Component\Routing\Attribute\Route;

final class AlphaInvitationRequestController extends AbstractController
{
    #[Route('/', name: 'public_alpha_invitation_request', methods: ['POST'])]
    public function __invoke(
        Request $request,
        EntityManagerInterface $entityManager,
        InvitationRequestClient $invitationRequestClient,
        MailerInterface $mailer,
        ParameterBagInterface $parameterBag,
    ): RedirectResponse {
        $email = mb_strtolower(trim((string) $request->request->get('email')));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->addFlash('error', 'Captura un correo valido para solicitar tu acceso alpha.');

            return $this->redirectToRoute('public_home');
        }

        $expiresInDays = (int) $parameterBag->get('app.alpha_invitation_expiry_days');
        $invitation = $invitationRequestClient->requestInvitation($email, $expiresInDays);

        if (!$invitation['ok'] || empty($invitation['invitation_url'])) {
            $this->addFlash('error', $invitation['errors'][0] ?? 'No se pudo generar tu invitacion alpha.');

            return $this->redirectToRoute('public_home');
        }

        $existingUser = $entityManager->getRepository(PublicUser::class)->findOneBy(['email' => $email]);
        $leadRepository = $entityManager->getRepository(PublicInterestLead::class);
        $existingLead = $leadRepository->findOneBy(['email' => $email]);

        if (!$existingUser instanceof PublicUser) {
            if (!$existingLead instanceof PublicInterestLead) {
                $existingLead = (new PublicInterestLead())
                    ->setEmail($email)
                    ->setSource('alpha_invite_request');

                $entityManager->persist($existingLead);
            }

            $existingLead->setLastInvitationSentAt(new \DateTimeImmutable());
            $entityManager->flush();
        }

        $absoluteInvitationUrl = $this->toAbsoluteUrl((string) $invitation['invitation_url'], $request);
        $expiresAt = $invitation['expires_at'] !== null && $invitation['expires_at'] !== ''
            ? new \DateTimeImmutable((string) $invitation['expires_at'])
            : null;

        $emailMessage = (new Email())
            ->from(new Address(
                (string) $parameterBag->get('app.alpha_from_email'),
                (string) $parameterBag->get('app.alpha_from_name'),
            ))
            ->to($email)
            ->subject('Tu acceso alpha a Mi Monchis MX')
            ->html($this->renderView('emails/public_alpha_invitation.html.twig', [
                'invitation_url' => $absoluteInvitationUrl,
                'expires_at' => $expiresAt,
                'logo_url' => $request->getSchemeAndHttpHost() . '/images/branding/logo-simple-vertical.png',
            ]));

        $mailerDsn = trim((string) $parameterBag->get('app.mailer_dsn'));
        if ($mailerDsn === '' || str_starts_with($mailerDsn, 'null://')) {
            $this->addFlash('error', 'MAILER_DSN sigue en null://null. Configura SMTP real en producción para poder enviar el enlace alpha.');

            return $this->redirectToRoute('public_home');
        }

        try {
            $mailer->send($emailMessage);
        } catch (TransportExceptionInterface|\Throwable $exception) {
            $this->addFlash('error', sprintf('No se pudo enviar el correo alpha: %s', $exception->getMessage()));

            return $this->redirectToRoute('public_home');
        }

        $this->addFlash('success', 'Te enviamos un enlace de acceso alpha a tu correo o accede desde aquí.');

        if ($this->getParameter('kernel.environment') === 'dev') {
            $this->addFlash('alpha_access_url', $absoluteInvitationUrl);
        }

        return $this->redirectToRoute('public_home');
    }

    private function toAbsoluteUrl(string $invitationUrl, Request $request): string
    {
        if (str_starts_with($invitationUrl, 'http://') || str_starts_with($invitationUrl, 'https://')) {
            return $invitationUrl;
        }

        return rtrim($request->getSchemeAndHttpHost(), '/') . '/' . ltrim($invitationUrl, '/');
    }
}
