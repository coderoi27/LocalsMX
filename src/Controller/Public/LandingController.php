<?php

declare(strict_types=1);

namespace App\Controller\Public;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Annotation\Route;

class LandingController extends AbstractController
{
    #[Route('/', name: 'public_landing', methods: ['GET'])]
    public function index(): Response
    {
        // Si el usuario ya está logueado, redirigir al panel.
        if ($this->getUser()) {
            // Nota: ajustar 'owner_dashboard' según la ruta real que se defina luego
            return $this->redirectToRoute('owner_locations_index');
        }

        return $this->render('public/landing.html.twig');
    }
}
