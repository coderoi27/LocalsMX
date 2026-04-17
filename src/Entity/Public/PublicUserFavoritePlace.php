<?php

declare(strict_types=1);

namespace App\Entity\Public;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'public_user_favorite_places')]
#[ORM\UniqueConstraint(name: 'uniq_public_user_location', columns: ['public_user_id', 'location_id'])]
class PublicUserFavoritePlace
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: PublicUser::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private PublicUser $publicUser;

    #[ORM\Column]
    private int $locationId;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct()
    {
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function setPublicUser(PublicUser $publicUser): self
    {
        $this->publicUser = $publicUser;

        return $this;
    }

    public function setLocationId(int $locationId): self
    {
        $this->locationId = $locationId;

        return $this;
    }

    public function getLocationId(): int
    {
        return $this->locationId;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
