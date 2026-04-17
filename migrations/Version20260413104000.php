<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260413104000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Creates public user addresses and favorite places tables.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE public_user_addresses (id INT AUTO_INCREMENT NOT NULL, public_user_id INT NOT NULL, label VARCHAR(120) NOT NULL, city VARCHAR(120) DEFAULT NULL, state VARCHAR(120) DEFAULT NULL, reference VARCHAR(180) DEFAULT NULL, latitude NUMERIC(10, 7) DEFAULT NULL, longitude NUMERIC(10, 7) DEFAULT NULL, is_primary TINYINT(1) NOT NULL, is_active TINYINT(1) NOT NULL, created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', updated_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', INDEX IDX_F383E32F5A76ED395 (public_user_id), PRIMARY KEY(id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('CREATE TABLE public_user_favorite_places (id INT AUTO_INCREMENT NOT NULL, public_user_id INT NOT NULL, location_id INT NOT NULL, created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', INDEX IDX_5165D2A15A76ED395 (public_user_id), UNIQUE INDEX uniq_public_user_location (public_user_id, location_id), PRIMARY KEY(id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('ALTER TABLE public_user_addresses ADD CONSTRAINT FK_F383E32F5A76ED395 FOREIGN KEY (public_user_id) REFERENCES public_users (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE public_user_favorite_places ADD CONSTRAINT FK_5165D2A15A76ED395 FOREIGN KEY (public_user_id) REFERENCES public_users (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE public_user_addresses DROP FOREIGN KEY FK_F383E32F5A76ED395');
        $this->addSql('ALTER TABLE public_user_favorite_places DROP FOREIGN KEY FK_5165D2A15A76ED395');
        $this->addSql('DROP TABLE public_user_favorite_places');
        $this->addSql('DROP TABLE public_user_addresses');
    }
}
