<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260415093000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Creates public interest leads table for alpha invitation requests.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE public_interest_leads (id INT AUTO_INCREMENT NOT NULL, email VARCHAR(180) NOT NULL, source VARCHAR(32) NOT NULL, last_invitation_sent_at DATETIME DEFAULT NULL COMMENT \'(DC2Type:datetime_immutable)\', created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', updated_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', UNIQUE INDEX UNIQ_4617434DE7927C74 (email), PRIMARY KEY(id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE public_interest_leads');
    }
}
