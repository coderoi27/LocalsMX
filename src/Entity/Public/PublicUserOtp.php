<?php

declare(strict_types=1);

namespace App\Entity\Public;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'public_user_otps')]
class PublicUserOtp
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: PublicUser::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'SET NULL')]
    private ?PublicUser $publicUser = null;

    #[ORM\Column(length: 180)]
    private string $targetEmail;

    #[ORM\Column(length: 32)]
    private string $purpose = 'register_verify';

    #[ORM\Column(length: 255)]
    private string $otpHash;

    #[ORM\Column]
    private int $attempts = 0;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $consumedAt = null;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function setPublicUser(?PublicUser $publicUser): self
    {
        $this->publicUser = $publicUser;

        return $this;
    }

    public function setTargetEmail(string $targetEmail): self
    {
        $this->targetEmail = mb_strtolower($targetEmail);

        return $this;
    }

    public function getTargetEmail(): string
    {
        return $this->targetEmail;
    }

    public function setPurpose(string $purpose): self
    {
        $this->purpose = $purpose;

        return $this;
    }

    public function setOtpHash(string $otpHash): self
    {
        $this->otpHash = $otpHash;

        return $this;
    }

    public function verify(string $code): bool
    {
        return hash_equals($this->otpHash, hash('sha256', $code));
    }

    public function consume(): self
    {
        $this->consumedAt = new \DateTimeImmutable();

        return $this;
    }

    public function increaseAttempts(): self
    {
        ++$this->attempts;

        return $this;
    }

    public function isExpired(): bool
    {
        return $this->expiresAt <= new \DateTimeImmutable();
    }

    public function setExpiresAt(\DateTimeImmutable $expiresAt): self
    {
        $this->expiresAt = $expiresAt;

        return $this;
    }

    public function getConsumedAt(): ?\DateTimeImmutable
    {
        return $this->consumedAt;
    }

    public function getAttempts(): int
    {
        return $this->attempts;
    }

    public function setCreatedAt(\DateTimeImmutable $createdAt): self
    {
        $this->createdAt = $createdAt;

        return $this;
    }
}
