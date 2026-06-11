<?php

declare(strict_types=1);

namespace App\Controller\Owner;

use App\Entity\OwnerUser;
use App\Service\CoreLocationGateway;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\Routing\Attribute\Route;

final class LocationProfileController extends AbstractController
{
    #[Route('/mi-local', name: 'locals_location_profile', methods: ['GET'])]
    public function index(CoreLocationGateway $coreLocationGateway): Response
    {
        $user = $this->getUser();
        if (!$user instanceof OwnerUser) {
            throw $this->createAccessDeniedException();
        }

        $locations = $coreLocationGateway->findOwnedLocations($user);
        $location = isset($locations[0]['core_location_id'])
            ? $coreLocationGateway->findEditableLocation($user, (int) $locations[0]['core_location_id'])
            : null;

        return $this->render('owner/location_profile.html.twig', [
            'owner_user' => $user,
            'locations' => $locations,
            'location' => $location,
            'errors' => [],
            'form' => $this->formData($location),
        ]);
    }

    #[Route('/mi-local/{coreLocationId}', name: 'locals_location_profile_edit', requirements: ['coreLocationId' => '\d+'], methods: ['GET', 'POST'])]
    public function edit(int $coreLocationId, Request $request, CoreLocationGateway $coreLocationGateway): Response
    {
        $user = $this->getUser();
        if (!$user instanceof OwnerUser) {
            throw $this->createAccessDeniedException();
        }

        $locations = $coreLocationGateway->findOwnedLocations($user);
        $location = $coreLocationGateway->findEditableLocation($user, $coreLocationId);
        if ($location === null) {
            throw $this->createNotFoundException('No tienes acceso a este local.');
        }

        $form = $this->formData($location);
        $errors = [];

        if ($request->isMethod('POST')) {
            try {
                $form = $this->submittedData($request, $coreLocationId);
            } catch (\RuntimeException $exception) {
                $errors[] = $exception->getMessage();
            }

            if (!$this->isCsrfTokenValid(sprintf('locals_location_profile_%d', $coreLocationId), (string) $request->request->get('_token'))) {
                $errors[] = 'No se pudo validar la sesión del formulario.';
            }

            if ($location['can_edit_profile'] !== true) {
                $errors[] = 'Tu acceso actual no permite editar el perfil del local.';
            }

            if ($form['name'] === '') {
                $errors[] = 'El nombre público del local es obligatorio.';
            }

            if ($form['short_description'] !== null && mb_strlen($form['short_description']) > 500) {
                $errors[] = 'La descripción corta no debe exceder 500 caracteres.';
            }

            $this->validateOpeningHours($form['opening_hours'], $errors);
            $this->validateOpeningExceptions($form['opening_exceptions'], $errors);
            $this->validateUrls($form, $errors);

            if ($errors === []) {
                $coreLocationGateway->updateBasicProfile($user, $coreLocationId, $form);
                $this->addFlash('success', 'Perfil público del local actualizado.');

                return $this->redirectToRoute('locals_location_profile_edit', ['coreLocationId' => $coreLocationId]);
            }
        }

        return $this->render('owner/location_profile.html.twig', [
            'owner_user' => $user,
            'locations' => $locations,
            'location' => $location,
            'errors' => $errors,
            'form' => $form,
        ]);
    }

    /**
     * @param array<string, mixed>|null $location
     * @return array<string, mixed>
     */
    private function formData(?array $location): array
    {
        $mediaItems = is_array($location['media_items'] ?? null) ? $location['media_items'] : [];
        $socialLinks = is_array($location['social_links'] ?? null) ? $location['social_links'] : [];

        return [
            'name' => trim((string) ($location['name'] ?? '')),
            'phone_e164' => $this->emptyToNull((string) ($location['phone_e164'] ?? '')),
            'whatsapp_e164' => $this->emptyToNull((string) ($location['whatsapp_e164'] ?? '')),
            'whatsapp_enabled' => (bool) ($location['whatsapp_enabled'] ?? false),
            'short_description' => $this->emptyToNull((string) ($location['short_description'] ?? '')),
            'offers_delivery' => (bool) ($location['offers_delivery'] ?? false),
            'offers_takeaway' => (bool) ($location['offers_takeaway'] ?? false),
            'offers_dine_in' => array_key_exists('offers_dine_in', $location ?? []) && $location['offers_dine_in'] !== null ? (bool) $location['offers_dine_in'] : true,
            'delivery_notes' => $this->emptyToNull((string) ($location['delivery_notes'] ?? '')),
            'service_notes' => $this->emptyToNull((string) ($location['service_notes'] ?? '')),
            'opening_hours' => $this->openingHoursFormData(is_array($location['opening_hours'] ?? null) ? $location['opening_hours'] : []),
            'opening_exceptions' => $this->openingExceptionsFormData(is_array($location['opening_exceptions'] ?? null) ? $location['opening_exceptions'] : []),
            'primary_photo_url' => $this->mediaUrl($mediaItems, 'photo'),
            'logo_url' => $this->mediaUrl($mediaItems, 'logo'),
            'menu_image_url' => $this->mediaUrl($mediaItems, 'menu'),
            'instagram_url' => $this->socialUrl($socialLinks, 'instagram'),
            'facebook_url' => $this->socialUrl($socialLinks, 'facebook'),
            'tiktok_url' => $this->socialUrl($socialLinks, 'tiktok'),
            'website_url' => $this->socialUrl($socialLinks, 'website'),
            'menu_url' => $this->socialUrl($socialLinks, 'menu'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function submittedData(Request $request, int $coreLocationId): array
    {
        $mediaItems = $this->submittedMediaItems($request, $coreLocationId);
        $socialLinks = $this->submittedSocialLinks($request);

        return [
            'name' => trim($request->request->getString('name', '')),
            'phone_e164' => $this->emptyToNull($request->request->getString('phone_e164', '')),
            'whatsapp_e164' => $this->emptyToNull($request->request->getString('whatsapp_e164', '')),
            'whatsapp_enabled' => $request->request->getBoolean('whatsapp_enabled', false),
            'short_description' => $this->emptyToNull($request->request->getString('short_description', '')),
            'offers_delivery' => $request->request->getBoolean('offers_delivery', false),
            'offers_takeaway' => $request->request->getBoolean('offers_takeaway', false),
            'offers_dine_in' => $request->request->getBoolean('offers_dine_in', false),
            'delivery_notes' => $this->emptyToNull($request->request->getString('delivery_notes', '')),
            'service_notes' => $this->emptyToNull($request->request->getString('service_notes', '')),
            'opening_hours' => $this->submittedOpeningHours($request),
            'opening_exceptions' => $this->submittedOpeningExceptions($request),
            'media_items' => $mediaItems,
            'social_links' => $socialLinks,
            'primary_photo_url' => $this->mediaUrl($mediaItems, 'photo'),
            'logo_url' => $this->mediaUrl($mediaItems, 'logo'),
            'menu_image_url' => $this->mediaUrl($mediaItems, 'menu'),
            'instagram_url' => $this->requestUrl($request, 'instagram_url'),
            'facebook_url' => $this->requestUrl($request, 'facebook_url'),
            'tiktok_url' => $this->requestUrl($request, 'tiktok_url'),
            'website_url' => $this->requestUrl($request, 'website_url'),
            'menu_url' => $this->requestUrl($request, 'menu_url'),
        ];
    }

    /**
     * @param array<int, array{is_closed?:bool, opens_at?:string|null, closes_at?:string|null}> $hours
     * @return array<int, array{is_closed:bool, opens_at:string|null, closes_at:string|null}>
     */
    private function openingHoursFormData(array $hours): array
    {
        $formHours = [];
        foreach ($this->openingDayLabels() as $day => $label) {
            $entry = is_array($hours[$day] ?? null) ? $hours[$day] : [];
            $formHours[$day] = [
                'is_closed' => array_key_exists('is_closed', $entry) ? (bool) $entry['is_closed'] : true,
                'opens_at' => is_string($entry['opens_at'] ?? null) ? $entry['opens_at'] : null,
                'closes_at' => is_string($entry['closes_at'] ?? null) ? $entry['closes_at'] : null,
            ];
        }

        return $formHours;
    }

    /**
     * @param list<array{exception_date?:string, label?:string|null, is_closed?:bool, opens_at?:string|null, closes_at?:string|null}> $exceptions
     * @return list<array{exception_date:string, label:string|null, is_closed:bool, opens_at:string|null, closes_at:string|null}>
     */
    private function openingExceptionsFormData(array $exceptions): array
    {
        $formExceptions = [];
        foreach ($exceptions as $exception) {
            if (!is_array($exception)) {
                continue;
            }

            $formExceptions[] = [
                'exception_date' => is_string($exception['exception_date'] ?? null) ? $exception['exception_date'] : '',
                'label' => $this->emptyToNull((string) ($exception['label'] ?? '')),
                'is_closed' => array_key_exists('is_closed', $exception) ? (bool) $exception['is_closed'] : true,
                'opens_at' => is_string($exception['opens_at'] ?? null) ? $exception['opens_at'] : null,
                'closes_at' => is_string($exception['closes_at'] ?? null) ? $exception['closes_at'] : null,
            ];
        }

        while (count($formExceptions) < 5) {
            $formExceptions[] = [
                'exception_date' => '',
                'label' => null,
                'is_closed' => true,
                'opens_at' => null,
                'closes_at' => null,
            ];
        }

        return array_slice($formExceptions, 0, 12);
    }

    /**
     * @return array<int, array{is_closed:bool, opens_at:string|null, closes_at:string|null}>
     */
    private function submittedOpeningHours(Request $request): array
    {
        $hours = [];
        foreach ($this->openingDayLabels() as $day => $label) {
            $isClosed = $request->request->getBoolean(sprintf('opening_closed_%d', $day), false);
            $hours[$day] = [
                'is_closed' => $isClosed,
                'opens_at' => $isClosed ? null : $this->emptyToNull($request->request->getString(sprintf('opening_opens_%d', $day), '')),
                'closes_at' => $isClosed ? null : $this->emptyToNull($request->request->getString(sprintf('opening_closes_%d', $day), '')),
            ];
        }

        return $hours;
    }

    /**
     * @return list<array{exception_date:string, label:string|null, is_closed:bool, opens_at:string|null, closes_at:string|null}>
     */
    private function submittedOpeningExceptions(Request $request): array
    {
        $exceptions = [];
        for ($index = 0; $index < 12; $index++) {
            $date = $this->emptyToNull($request->request->getString(sprintf('exception_date_%d', $index), ''));
            if ($date === null) {
                continue;
            }

            $isClosed = $request->request->getBoolean(sprintf('exception_closed_%d', $index), false);
            $exceptions[] = [
                'exception_date' => $date,
                'label' => $this->emptyToNull($request->request->getString(sprintf('exception_label_%d', $index), '')),
                'is_closed' => $isClosed,
                'opens_at' => $isClosed ? null : $this->emptyToNull($request->request->getString(sprintf('exception_opens_%d', $index), '')),
                'closes_at' => $isClosed ? null : $this->emptyToNull($request->request->getString(sprintf('exception_closes_%d', $index), '')),
            ];
        }

        return $exceptions;
    }

    /**
     * @return list<array{media_type:string, url:string, title:string|null, sort_order:int, is_primary:bool}>
     */
    private function submittedMediaItems(Request $request, int $coreLocationId): array
    {
        $items = [];
        foreach ([
            ['field' => 'primary_photo_url', 'file_field' => 'primary_photo_file', 'media_type' => 'photo', 'title' => 'Foto principal', 'sort_order' => 10, 'is_primary' => true],
            ['field' => 'logo_url', 'file_field' => 'logo_file', 'media_type' => 'logo', 'title' => 'Logo', 'sort_order' => 20, 'is_primary' => false],
            ['field' => 'menu_image_url', 'file_field' => 'menu_image_file', 'media_type' => 'menu', 'title' => 'Menú', 'sort_order' => 30, 'is_primary' => false],
        ] as $definition) {
            $url = $this->mediaFormUrl($request, $coreLocationId, $definition['field'], $definition['file_field']);
            if ($url === null) {
                continue;
            }
            $items[] = [
                'media_type' => $definition['media_type'],
                'url' => $url,
                'title' => $definition['title'],
                'sort_order' => $definition['sort_order'],
                'is_primary' => $definition['is_primary'],
            ];
        }

        return $items;
    }

    /**
     * @return list<array{platform:string, url:string, label:string|null}>
     */
    private function submittedSocialLinks(Request $request): array
    {
        $links = [];
        foreach ([
            ['field' => 'instagram_url', 'platform' => 'instagram', 'label' => 'Instagram'],
            ['field' => 'facebook_url', 'platform' => 'facebook', 'label' => 'Facebook'],
            ['field' => 'tiktok_url', 'platform' => 'tiktok', 'label' => 'TikTok'],
            ['field' => 'website_url', 'platform' => 'website', 'label' => 'Sitio web'],
            ['field' => 'menu_url', 'platform' => 'menu', 'label' => 'Menú'],
        ] as $definition) {
            $url = $this->requestUrl($request, $definition['field']);
            if ($url === null) {
                continue;
            }
            $links[] = [
                'platform' => $definition['platform'],
                'url' => $url,
                'label' => $definition['label'],
            ];
        }

        return $links;
    }

    private function mediaFormUrl(Request $request, int $coreLocationId, string $urlField, string $fileField): ?string
    {
        $uploadedUrl = $this->storeUploadedMedia($request, $coreLocationId, $fileField);

        return $uploadedUrl ?? $this->requestUrl($request, $urlField);
    }

    /**
     * @param array<int, array{is_closed:bool, opens_at:string|null, closes_at:string|null}> $openingHours
     * @param list<string> $errors
     */
    private function validateOpeningHours(array $openingHours, array &$errors): void
    {
        foreach ($this->openingDayLabels() as $day => $label) {
            $entry = $openingHours[$day] ?? null;
            if (!is_array($entry) || $entry['is_closed'] === true) {
                continue;
            }
            if (!$this->validTime($entry['opens_at']) || !$this->validTime($entry['closes_at'])) {
                $errors[] = sprintf('Captura apertura y cierre válidos para %s o márcalo como cerrado.', $label);
            }
        }
    }

    /**
     * @param list<array{exception_date:string, label:string|null, is_closed:bool, opens_at:string|null, closes_at:string|null}> $openingExceptions
     * @param list<string> $errors
     */
    private function validateOpeningExceptions(array $openingExceptions, array &$errors): void
    {
        $seenDates = [];
        foreach ($openingExceptions as $exception) {
            $date = $exception['exception_date'];
            if (!$this->validDate($date)) {
                $errors[] = 'Cada excepción de horario debe tener una fecha válida.';
                continue;
            }

            if (isset($seenDates[$date])) {
                $errors[] = sprintf('La fecha %s está duplicada en excepciones de horario.', $date);
            }
            $seenDates[$date] = true;

            if ($exception['is_closed'] === true) {
                continue;
            }

            if (!$this->validTime($exception['opens_at']) || !$this->validTime($exception['closes_at'])) {
                $errors[] = sprintf('Captura apertura y cierre válidos para la excepción del %s o márcala como cerrado.', $date);
            }
        }
    }

    /**
     * @param array<string, mixed> $form
     * @param list<string> $errors
     */
    private function validateUrls(array $form, array &$errors): void
    {
        foreach ([
            'primary_photo_url' => 'foto principal',
            'logo_url' => 'logo',
            'menu_image_url' => 'imagen de menú',
            'instagram_url' => 'Instagram',
            'facebook_url' => 'Facebook',
            'tiktok_url' => 'TikTok',
            'website_url' => 'sitio web',
            'menu_url' => 'menú externo',
        ] as $field => $label) {
            $url = $form[$field] ?? null;
            if ($url !== null && !$this->validUrl((string) $url)) {
                $errors[] = sprintf('La URL de %s no es válida.', $label);
            }
        }
    }

    /**
     * @return array<int, string>
     */
    private function openingDayLabels(): array
    {
        return [
            1 => 'Lunes',
            2 => 'Martes',
            3 => 'Miércoles',
            4 => 'Jueves',
            5 => 'Viernes',
            6 => 'Sábado',
            7 => 'Domingo',
        ];
    }

    /**
     * @param list<array{media_type:string, url:string, title:string|null, sort_order:int, is_primary:bool}> $mediaItems
     */
    private function mediaUrl(array $mediaItems, string $mediaType): ?string
    {
        foreach ($mediaItems as $item) {
            if (($item['media_type'] ?? '') === $mediaType && is_string($item['url'] ?? null)) {
                return $item['url'];
            }
        }

        return null;
    }

    /**
     * @param list<array{platform:string, url:string, label:string|null}> $socialLinks
     */
    private function socialUrl(array $socialLinks, string $platform): ?string
    {
        foreach ($socialLinks as $link) {
            if (($link['platform'] ?? '') === $platform && is_string($link['url'] ?? null)) {
                return $link['url'];
            }
        }

        return null;
    }

    private function requestUrl(Request $request, string $field): ?string
    {
        return $this->emptyToNull($request->request->getString($field, ''));
    }

    private function validUrl(string $url): bool
    {
        return filter_var($url, FILTER_VALIDATE_URL) !== false
            && in_array(parse_url($url, PHP_URL_SCHEME), ['http', 'https'], true);
    }

    private function storeUploadedMedia(Request $request, int $coreLocationId, string $field): ?string
    {
        $file = $request->files->get($field);
        if (!$file instanceof UploadedFile || $file->getError() === UPLOAD_ERR_NO_FILE) {
            return null;
        }

        if (!$file->isValid()) {
            throw new \RuntimeException(sprintf('No se pudo subir el archivo de %s.', $field));
        }

        if ($file->getSize() !== null && $file->getSize() > 4 * 1024 * 1024) {
            throw new \RuntimeException('Cada imagen debe pesar 4 MB o menos.');
        }

        $mimeType = (string) $file->getMimeType();
        $extensionsByMime = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
        ];
        if (!isset($extensionsByMime[$mimeType])) {
            throw new \RuntimeException('Solo se permiten imágenes JPG, PNG o WebP.');
        }

        $relativeDir = sprintf('/uploads/location-media/%d', $coreLocationId);
        $targetDir = $this->getParameter('kernel.project_dir') . '/public' . $relativeDir;
        if (!is_dir($targetDir) && !mkdir($targetDir, 0775, true) && !is_dir($targetDir)) {
            throw new \RuntimeException('No se pudo preparar el directorio de carga de media.');
        }

        $filename = sprintf('%s-%s.%s', str_replace('_file', '', $field), bin2hex(random_bytes(6)), $extensionsByMime[$mimeType]);
        $file->move($targetDir, $filename);

        return $request->getSchemeAndHttpHost() . $request->getBasePath() . $relativeDir . '/' . $filename;
    }

    private function validTime(?string $value): bool
    {
        if ($value === null) {
            return false;
        }

        return (bool) preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $value);
    }

    private function validDate(string $value): bool
    {
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        return $date instanceof \DateTimeImmutable && $date->format('Y-m-d') === $value;
    }

    private function emptyToNull(string $value): ?string
    {
        $value = trim($value);

        return $value !== '' ? $value : null;
    }
}
