<?php

declare(strict_types=1);

namespace App\Controller\Public;

use App\Service\Public\AlphaAccessClient;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\ParameterBag\ParameterBagInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class AlphaAccessController extends AbstractController
{
    #[Route('/alpha/access', name: 'public_alpha_access', methods: ['GET', 'POST'])]
    public function __invoke(
        Request $request,
        AlphaAccessClient $alphaAccessClient,
        ParameterBagInterface $parameterBag,
    ): Response {
        $inviteRequired = (bool) $parameterBag->get('app.alpha_invite_required');
        if (!$inviteRequired) {
            $request->getSession()->set('alpha_access_granted', true);

            return $this->redirectToRoute('public_home');
        }

        if ($request->getSession()->get('alpha_access_granted') === true) {
            return $this->redirectToRoute('public_home');
        }

        $prefilledAccessCode = trim((string) $request->query->get('token', $request->request->get('access_code', '')));
        if ($prefilledAccessCode === '') {
            return $this->redirectToRoute('public_home');
        }

        $validation = $alphaAccessClient->validateAccessCode($prefilledAccessCode);

        if ($validation['valid']) {
            $request->getSession()->set('alpha_access_granted', true);
            $request->getSession()->set('alpha_access_code', $prefilledAccessCode);
            $request->getSession()->set('alpha_invitation', $validation['invitation']);

            return $this->redirectToRoute('public_home');
        }

        $this->addFlash('error', $validation['errors'][0] ?? 'Tu token ya no es valido. Solicita uno nuevo.');

        return $this->redirectToRoute('public_home');
    }
}
