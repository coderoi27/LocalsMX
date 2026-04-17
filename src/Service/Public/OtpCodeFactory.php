<?php

declare(strict_types=1);

namespace App\Service\Public;

final class OtpCodeFactory
{
    public function createCode(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    public function hash(string $code): string
    {
        return hash('sha256', $code);
    }
}
