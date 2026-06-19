<?php

declare(strict_types=1);

namespace App\Controller\Public;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class LandingController extends AbstractController
{
    #[Route('/', name: 'public_landing', methods: ['GET'])]
    public function index(): Response
    {
        if ($this->getUser() !== null) {
            return $this->redirectToRoute('locals_dashboard');
        }

        return $this->render('public/landing.html.twig');
    }
}
