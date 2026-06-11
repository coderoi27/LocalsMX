<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'owner_user_location_access')]
#[ORM\UniqueConstraint(name: 'uniq_owner_user_location_access', columns: ['owner_user_id', 'core_location_id'])]
class OwnerUserLocationAccess
{
    public const ROLE_OWNER = 'owner';
    public const ROLE_MANAGER = 'manager';
    public const ROLE_STAFF = 'staff';

    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: OwnerUser::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private OwnerUser $ownerUser;

    #[ORM\Column]
    private int $coreLocationId;

    #[ORM\Column(length: 24)]
    private string $roleKey = self::ROLE_STAFF;

    #[ORM\Column]
    private bool $canEditProfile = false;

    #[ORM\Column]
    private bool $canManageStaff = false;

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

    public function getOwnerUser(): OwnerUser
    {
        return $this->ownerUser;
    }

    public function setOwnerUser(OwnerUser $ownerUser): self
    {
        $this->ownerUser = $ownerUser;

        return $this;
    }

    public function getCoreLocationId(): int
    {
        return $this->coreLocationId;
    }

    public function setCoreLocationId(int $coreLocationId): self
    {
        $this->coreLocationId = $coreLocationId;

        return $this;
    }

    public function getRoleKey(): string
    {
        return $this->roleKey;
    }

    public function setRoleKey(string $roleKey): self
    {
        if (!in_array($roleKey, self::roleKeys(), true)) {
            throw new \InvalidArgumentException(sprintf('Unsupported location access role "%s".', $roleKey));
        }

        $this->roleKey = $roleKey;

        return $this;
    }

    public function canEditProfile(): bool
    {
        return $this->canEditProfile;
    }

    public function setCanEditProfile(bool $canEditProfile): self
    {
        $this->canEditProfile = $canEditProfile;

        return $this;
    }

    public function canManageStaff(): bool
    {
        return $this->canManageStaff;
    }

    public function setCanManageStaff(bool $canManageStaff): self
    {
        $this->canManageStaff = $canManageStaff;

        return $this;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    /**
     * @return list<string>
     */
    public static function roleKeys(): array
    {
        return [self::ROLE_OWNER, self::ROLE_MANAGER, self::ROLE_STAFF];
    }
}
