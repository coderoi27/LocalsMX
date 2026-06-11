<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260609133000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Creates owner users and owner location access tables for Locals.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE owner_users (id INT AUTO_INCREMENT NOT NULL, email VARCHAR(180) NOT NULL, full_name VARCHAR(140) NOT NULL, role_key VARCHAR(24) NOT NULL, status VARCHAR(32) NOT NULL, registration_origin VARCHAR(32) NOT NULL, password_hash VARCHAR(255) NOT NULL, last_login_at DATETIME DEFAULT NULL COMMENT \'(DC2Type:datetime_immutable)\', google_id VARCHAR(255) DEFAULT NULL, google_avatar VARCHAR(1024) DEFAULT NULL, created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', updated_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', UNIQUE INDEX UNIQ_OWNER_USERS_EMAIL (email), UNIQUE INDEX uniq_owner_users_google_id (google_id), PRIMARY KEY(id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('CREATE TABLE owner_user_location_access (id INT AUTO_INCREMENT NOT NULL, owner_user_id INT NOT NULL, core_location_id INT NOT NULL, role_key VARCHAR(24) NOT NULL, can_edit_profile TINYINT(1) NOT NULL, can_manage_staff TINYINT(1) NOT NULL, created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', INDEX IDX_OWNER_LOCATION_ACCESS_USER (owner_user_id), UNIQUE INDEX uniq_owner_user_location_access (owner_user_id, core_location_id), PRIMARY KEY(id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('ALTER TABLE owner_user_location_access ADD CONSTRAINT FK_OWNER_LOCATION_ACCESS_USER FOREIGN KEY (owner_user_id) REFERENCES owner_users (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE owner_user_location_access DROP FOREIGN KEY FK_OWNER_LOCATION_ACCESS_USER');
        $this->addSql('DROP TABLE owner_user_location_access');
        $this->addSql('DROP TABLE owner_users');
    }
}
