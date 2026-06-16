<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260616120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Adds source metadata to owner location access grants for approved claim sync.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE owner_user_location_access ADD source_type VARCHAR(32) NOT NULL DEFAULT 'manual', ADD source_claim_id INT DEFAULT NULL, ADD granted_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)', ADD updated_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)'");
        $this->addSql('UPDATE owner_user_location_access SET granted_at = created_at, updated_at = created_at');
        $this->addSql("ALTER TABLE owner_user_location_access MODIFY granted_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)', MODIFY updated_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)'");
        $this->addSql('CREATE INDEX IDX_OWNER_LOCATION_ACCESS_SOURCE_CLAIM ON owner_user_location_access (source_claim_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX IDX_OWNER_LOCATION_ACCESS_SOURCE_CLAIM ON owner_user_location_access');
        $this->addSql('ALTER TABLE owner_user_location_access DROP source_type, DROP source_claim_id, DROP granted_at, DROP updated_at');
    }
}
