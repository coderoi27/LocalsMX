<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;

#[ORM\Entity]
#[ORM\Table(name: 'owner_users')]
#[ORM\UniqueConstraint(name: 'uniq_owner_users_google_id', columns: ['google_id'])]
#[ORM\HasLifecycleCallbacks]
class OwnerUser implements UserInterface, PasswordAuthenticatedUserInterface
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_INVITED = 'invited';
    public const STATUS_SUSPENDED = 'suspended';

    public const ROLE_OWNER = 'owner';
    public const ROLE_MANAGER = 'manager';
    public const ROLE_STAFF = 'staff';

    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 180, unique: true)]
    private string $email;

    #[ORM\Column(length: 140)]
    private string $fullName;

    #[ORM\Column(length: 24)]
    private string $roleKey = self::ROLE_OWNER;

    #[ORM\Column(length: 32)]
    private string $status = self::STATUS_ACTIVE;

    #[ORM\Column(length: 32)]
    private string $registrationOrigin = 'organic';

    #[ORM\Column(length: 255)]
    private string $passwordHash;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $lastLoginAt = null;

    #[ORM\Column(length: 255, nullable: true)]
    private ?string $googleId = null;

    #[ORM\Column(length: 1024, nullable: true)]
    private ?string $googleAvatar = null;

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

    public function getEmail(): string
    {
        return $this->email;
    }

    public function setEmail(string $email): self
    {
        $this->email = mb_strtolower(trim($email));

        return $this;
    }

    public function getFullName(): string
    {
        return $this->fullName;
    }

    public function setFullName(string $fullName): self
    {
        $this->fullName = trim($fullName);

        return $this;
    }

    public function getRoleKey(): string
    {
        return $this->roleKey;
    }

    public function setRoleKey(string $roleKey): self
    {
        if (!in_array($roleKey, self::roleKeys(), true)) {
            throw new \InvalidArgumentException(sprintf('Unsupported owner user role "%s".', $roleKey));
        }

        $this->roleKey = $roleKey;

        return $this;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function setStatus(string $status): self
    {
        if (!in_array($status, self::statuses(), true)) {
            throw new \InvalidArgumentException(sprintf('Unsupported owner user status "%s".', $status));
        }

        $this->status = $status;

        return $this;
    }

    public function getRegistrationOrigin(): string
    {
        return $this->registrationOrigin;
    }

    public function setRegistrationOrigin(string $registrationOrigin): self
    {
        $registrationOrigin = trim($registrationOrigin);
        $this->registrationOrigin = $registrationOrigin !== '' ? mb_substr($registrationOrigin, 0, 32) : 'organic';

        return $this;
    }

    public function getPassword(): string
    {
        return $this->passwordHash;
    }

    public function setPasswordHash(string $passwordHash): self
    {
        $this->passwordHash = $passwordHash;

        return $this;
    }

    public function getLastLoginAt(): ?\DateTimeImmutable
    {
        return $this->lastLoginAt;
    }

    public function setLastLoginAt(?\DateTimeImmutable $lastLoginAt): self
    {
        $this->lastLoginAt = $lastLoginAt;

        return $this;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getUserIdentifier(): string
    {
        return $this->email;
    }

    public function getRoles(): array
    {
        $roles = ['ROLE_OWNER_USER'];

        if ($this->roleKey === self::ROLE_OWNER) {
            $roles[] = 'ROLE_OWNER_ADMIN';
        }

        if (in_array($this->roleKey, [self::ROLE_OWNER, self::ROLE_MANAGER], true)) {
            $roles[] = 'ROLE_OWNER_MANAGER';
        }

        return array_values(array_unique($roles));
    }

    public function eraseCredentials(): void
    {
    }

    /**
     * @return list<string>
     */
    public static function statuses(): array
    {
        return [self::STATUS_ACTIVE, self::STATUS_INVITED, self::STATUS_SUSPENDED];
    }

    /**
     * @return list<string>
     */
    public static function roleKeys(): array
    {
        return [self::ROLE_OWNER, self::ROLE_MANAGER, self::ROLE_STAFF];
    }

    public function getGoogleId(): ?string
    {
        return $this->googleId;
    }

    public function setGoogleId(?string $googleId): self
    {
        $this->googleId = $googleId;

        return $this;
    }

    public function getGoogleAvatar(): ?string
    {
        return $this->googleAvatar;
    }

    public function setGoogleAvatar(?string $googleAvatar): self
    {
        $this->googleAvatar = $googleAvatar;

        return $this;
    }
}
