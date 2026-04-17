<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Public\PublicUser;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAccountStatusException;
use Symfony\Component\Security\Core\User\UserCheckerInterface;
use Symfony\Component\Security\Core\User\UserInterface;

final class PublicUserChecker implements UserCheckerInterface
{
    public function checkPreAuth(UserInterface $user): void
    {
    }

    public function checkPostAuth(UserInterface $user): void
    {
        if (!$user instanceof PublicUser) {
            return;
        }

        if ($user->getStatus() !== 'active') {
            throw new CustomUserMessageAccountStatusException('Debes verificar tu correo antes de iniciar sesión.');
        }
    }
}
