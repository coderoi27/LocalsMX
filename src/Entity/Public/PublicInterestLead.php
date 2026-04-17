<?php

declare(strict_types=1);

namespace App\Entity\Public;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'public_interest_leads')]
#[ORM\HasLifecycleCallbacks]
class PublicInterestLead
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 180, unique: true)]
    private string $email;

    #[ORM\Column(length: 32)]
    private string $source = 'alpha_invite_request';

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $lastInvitationSentAt = null;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $updatedAt;

    #[ORM\PrePersist]
    public function onCreate(): void
    {
        $now = new \DateTimeImmutable();
        $this->createdAt = $now;
        $this->updatedAt = $now;
    }

    #[ORM\PreUpdate]
    public function onUpdate(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function setEmail(string $email): self
    {
        $this->email = mb_strtolower($email);

        return $this;
    }

    public function getEmail(): string
    {
        return $this->email;
    }

    public function setSource(string $source): self
    {
        $this->source = $source;

        return $this;
    }

    public function setLastInvitationSentAt(?\DateTimeImmutable $lastInvitationSentAt): self
    {
        $this->lastInvitationSentAt = $lastInvitationSentAt;

        return $this;
    }
}
