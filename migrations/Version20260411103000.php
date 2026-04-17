<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260411103000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Creates public user and OTP bootstrap tables.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE public_users (id INT AUTO_INCREMENT NOT NULL, first_name VARCHAR(120) NOT NULL, last_name VARCHAR(120) NOT NULL, email VARCHAR(180) NOT NULL, password_hash VARCHAR(255) NOT NULL, status VARCHAR(32) NOT NULL, registration_origin VARCHAR(32) NOT NULL, email_verified_at DATETIME DEFAULT NULL COMMENT \'(DC2Type:datetime_immutable)\', created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', updated_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', UNIQUE INDEX UNIQ_3B3C8F39E7927C74 (email), PRIMARY KEY(id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('CREATE TABLE public_user_otps (id INT AUTO_INCREMENT NOT NULL, public_user_id INT DEFAULT NULL, target_email VARCHAR(180) NOT NULL, purpose VARCHAR(32) NOT NULL, otp_hash VARCHAR(255) NOT NULL, attempts INT NOT NULL, expires_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', consumed_at DATETIME DEFAULT NULL COMMENT \'(DC2Type:datetime_immutable)\', created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', INDEX IDX_4E4025705A76ED395 (public_user_id), PRIMARY KEY(id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('ALTER TABLE public_user_otps ADD CONSTRAINT FK_4E4025705A76ED395 FOREIGN KEY (public_user_id) REFERENCES public_users (id) ON DELETE SET NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE public_user_otps DROP FOREIGN KEY FK_4E4025705A76ED395');
        $this->addSql('DROP TABLE public_user_otps');
        $this->addSql('DROP TABLE public_users');
    }
}
