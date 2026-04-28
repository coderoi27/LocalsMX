import { Controller } from '@hotwired/stimulus';

export default class extends Controller {
    static targets = [
        'canvas',
        'status',
        'count',
        'list',
        'heroLocation',
        'chipRow',
        'categoryChip',
        'notificationsButton',
        'notificationsPanel',
        'locationSwitcherButton',
        'locationSwitcher',
        'notificationsBadge',
        'favoritesCount',
        'favoritesCountDuplicate',
        'favoritesList',
        'addressesCount',
        'addressesCountDuplicate',
        'addressesList',
        'addressLabelInput',
        'addressCityInput',
        'addressStateInput',
        'addressReferenceInput',
        'addressLatInput',
        'addressLngInput',
        'addressPrimaryInput',
        'addressStatus',
        'canvasNote',
        'walkthrough',
        'walkthroughCursor',
        'walkthroughCopy',
        'walkthroughForm',
        'walkthroughAddressInput',
        'walkthroughSuggestions',
        'walkthroughGeoButton',
        'walkthroughLogo',
        'walkthroughError',
    ];
    static values = {
        feedUrl: String,
        favoritesUrl: String,
        addressesUrl: String,
        googleMapsApiKey: String,
        walkthroughEnabled: Boolean,
        logoUrl: String,
        authenticated: Boolean,
        initialFavorites: Array,
        initialAddresses: Array,
        lat: Number,
        lng: Number,
    };

    connect() {
        this.latValue = this.hasLatValue ? Number(this.latValue) : Number.NaN;
        this.lngValue = this.hasLngValue ? Number(this.lngValue) : Number.NaN;
        this.favoriteLocationIds = Array.isArray(this.initialFavoritesValue) ? [...this.initialFavoritesValue] : [];
        this.savedAddresses = Array.isArray(this.initialAddressesValue) ? [...this.initialAddressesValue] : [];
        this.currentLocations = [];
        this.visibleLocations = [];
        this.currentFeedSource = 'canonical';
        this.categoryDefinitions = {
            taqueria: { label: 'Tacos' },
            vegetariano: { label: 'Veggie' },
            cafeteria: { label: 'Café' },
            restaurante: { label: 'Comida' },
        };
        this.selectedLocationId = null;
        this.activeCategoryFilter = 'all';
        this.map = null;
        this.markers = [];
        this.infoWindow = null;
        this.googleMapsReady = false;
        this.currentMapTypeId = 'roadmap';
        this.walkthroughTypingTimer = null;
        this.walkthroughHideTimer = null;
        this.mapIdleTimer = null;
        this.walkthroughPredictions = [];
        this.walkthroughSelection = null;
        this.userMarker = null;
        this.notificationsOpen = false;
        this.locationSwitcherOpen = false;
        this.placeDetailsCache = new Map();
        this.lastDiscoveryCenter = null;
        this.isDiscoveringPlaces = false;
        this.isSyncingMapViewport = false;
        this.currentLocationLabel = this.hasHeroLocationTarget ? this.heroLocationTarget.textContent.trim() : '';
        this.restorePersistedLocationContext();
        this.renderFavoritesSummary();
        this.renderAddressesSummary();
        const walkthroughIsActive = this.initializeWalkthrough();
        if (!walkthroughIsActive || this.hasUserCoordinates()) {
            this.loadFeed();
        }
    }

    disconnect() {
        if (this.walkthroughTypingTimer) {
            window.clearTimeout(this.walkthroughTypingTimer);
        }
        if (this.walkthroughHideTimer) {
            window.clearTimeout(this.walkthroughHideTimer);
        }
        if (this.mapIdleTimer) {
            window.clearTimeout(this.mapIdleTimer);
        }
    }

    async detectLocation() {
        try {
            this.setStatus('Solicitando geolocalización...');
            const coords = await this.requestGeolocation();
            this.applyCoordinates(coords.latitude, coords.longitude);
            this.updateHeroLocation('Ubicación actual');
            this.setStatus('Ubicación detectada. Refrescando feed...');
            await this.loadFeed();
        } catch (error) {
            this.setStatus(`No se pudo obtener tu ubicación: ${error.message}`);
        }
    }

    async detectLocationFromWalkthrough() {
        this.setWalkthroughError('');

        try {
            const coords = await this.requestGeolocation();
            this.applyCoordinates(coords.latitude, coords.longitude);
            this.updateHeroLocation('Ubicación actual');
            await this.completeWalkthrough();
            await this.loadFeed();
            this.refreshMapViewport();
            this.setStatus('Ubicación detectada desde el walkthrough.');
        } catch (error) {
            this.setWalkthroughError(`No se pudo obtener tu ubicación: ${error.message}`);
        }
    }

    async submitWalkthroughAddress(event) {
        event.preventDefault();

        const address = this.hasWalkthroughAddressInputTarget ? this.walkthroughAddressInputTarget.value.trim() : '';
        if (address === '') {
            this.setWalkthroughError('Escribe una direccion antes de continuar.');
            return;
        }

        this.setWalkthroughError('');

        try {
            const selection = await this.resolveWalkthroughSelection(address);
            this.applyCoordinates(selection.lat, selection.lng);
            this.updateHeroLocation(selection.label);
            this.walkthroughSelection = selection;
            this.hideWalkthroughSuggestions();
            await this.completeWalkthrough();
            await this.loadFeed();
            this.refreshMapViewport();
            this.setStatus(`Explorando cerca de ${selection.label}.`);
        } catch (error) {
            this.setWalkthroughError(error.message);
        }
    }

    async searchWalkthroughAddress() {
        if (!this.hasWalkthroughAddressInputTarget) {
            return;
        }

        if (this.walkthroughHideTimer) {
            window.clearTimeout(this.walkthroughHideTimer);
        }

        const query = this.walkthroughAddressInputTarget.value.trim();
        if (query.length < 3) {
            this.walkthroughSelection = null;
            this.walkthroughPredictions = [];
            this.hideWalkthroughSuggestions();
            return;
        }

        if (this.walkthroughSelection && this.walkthroughSelection.label !== query) {
            this.walkthroughSelection = null;
        }

        try {
            this.walkthroughPredictions = await this.fetchPlacePredictions(query);
            this.setWalkthroughError('');
            this.renderWalkthroughSuggestions();
        } catch (error) {
            this.walkthroughPredictions = [];
            this.hideWalkthroughSuggestions();
            if (!error.message.includes('Places')) {
                this.setWalkthroughError(error.message);
            }
        }
    }

    async selectWalkthroughSuggestion(event) {
        const placeId = event.currentTarget.dataset.placeId ?? '';
        if (placeId === '') {
            return;
        }

        const prediction = this.walkthroughPredictions.find((item) => item.placeId === placeId);
        if (!prediction) {
            return;
        }

        try {
            const details = await this.fetchPlaceDetails(placeId);
            this.walkthroughSelection = {
                lat: details.lat,
                lng: details.lng,
                label: prediction.primaryText || prediction.description,
                description: prediction.description,
                placeId,
            };
            this.walkthroughAddressInputTarget.value = prediction.description;
            this.setWalkthroughError('');
            this.renderWalkthroughSuggestions();
        } catch (error) {
            this.setWalkthroughError(error.message);
        }
    }

    queueHideWalkthroughSuggestions() {
        if (this.walkthroughHideTimer) {
            window.clearTimeout(this.walkthroughHideTimer);
        }

        this.walkthroughHideTimer = window.setTimeout(() => {
            this.hideWalkthroughSuggestions();
        }, 180);
    }

    toggleNotifications() {
        this.notificationsOpen = !this.notificationsOpen;
        this.renderNotificationsState();
    }

    closeNotificationsOnOutsideClick(event) {
        if (!this.notificationsOpen || !this.hasNotificationsPanelTarget || !this.hasNotificationsButtonTarget) {
            return;
        }

        const clickedInsidePanel = this.notificationsPanelTarget.contains(event.target);
        const clickedButton = this.notificationsButtonTarget.contains(event.target);
        if (!clickedInsidePanel && !clickedButton) {
            this.notificationsOpen = false;
            this.renderNotificationsState();
        }
    }

    toggleLocationSwitcher() {
        this.locationSwitcherOpen = !this.locationSwitcherOpen;
        this.renderLocationSwitcherState();
    }

    closeLocationSwitcherOnOutsideClick(event) {
        if (!this.locationSwitcherOpen || !this.hasLocationSwitcherTarget || !this.hasLocationSwitcherButtonTarget) {
            return;
        }

        const clickedInsidePanel = this.locationSwitcherTarget.contains(event.target);
        const clickedButton = this.locationSwitcherButtonTarget.contains(event.target);
        if (!clickedInsidePanel && !clickedButton) {
            this.locationSwitcherOpen = false;
            this.renderLocationSwitcherState();
        }
    }

    async selectSavedAddress(event) {
        const { lat, lng, label } = event.currentTarget.dataset;
        this.applyCoordinates(Number(lat), Number(lng));
        this.updateHeroLocation(label);
        await this.loadFeed();
        this.locationSwitcherOpen = false;
        this.renderLocationSwitcherState();
    }

    async focusLocation(event) {
        const interactiveElement = event.target.closest('button, a, input, label, form');
        if (interactiveElement) {
            return;
        }

        const locationKey = event.currentTarget.dataset.locationKey ?? '';
        if (locationKey === '') {
            return;
        }

        const location = this.currentLocations.find((item) => this.locationKey(item) === locationKey);
        if (!location) {
            return;
        }

        this.setSelectedLocation(locationKey);
        const enrichedLocation = await this.enrichLocationIfNeeded(location);

        if (this.googleMapsReady && this.map) {
            this.focusMapLocation(enrichedLocation);
            return;
        }

        this.setStatus(`Local seleccionado: ${enrichedLocation.location_name ?? locationKey}.`);
    }

    async toggleFavorite(event) {
        if (!this.authenticatedValue) {
            this.setStatus('Inicia sesión para guardar favoritos.');
            return;
        }

        const button = event.currentTarget;
        const locationId = Number.parseInt(button.dataset.locationId ?? '', 10);
        if (Number.isNaN(locationId)) {
            this.setStatus('No se pudo identificar el local.');
            return;
        }

        button.disabled = true;

        try {
            if (this.favoriteLocationIds.includes(locationId)) {
                await this.requestJson(`${this.favoritesUrlValue}/${locationId}`, { method: 'DELETE' });
                this.favoriteLocationIds = this.favoriteLocationIds.filter((id) => id !== locationId);
                this.setStatus(`Local #${locationId} eliminado de favoritos.`);
            } else {
                await this.requestJson(this.favoritesUrlValue, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ location_id: locationId }),
                });
                this.favoriteLocationIds = [...this.favoriteLocationIds, locationId];
                this.setStatus(`Local #${locationId} guardado en favoritos.`);
            }

            this.renderFavoritesSummary();
            this.syncFavoriteButtons();
        } catch (error) {
            this.setStatus(error.message);
        } finally {
            button.disabled = false;
        }
    }

    async removeFavoriteFromList(event) {
        if (!this.authenticatedValue) {
            return;
        }

        const locationId = Number.parseInt(event.currentTarget.dataset.locationId ?? '', 10);
        if (Number.isNaN(locationId)) {
            return;
        }

        try {
            await this.requestJson(`${this.favoritesUrlValue}/${locationId}`, { method: 'DELETE' });
            this.favoriteLocationIds = this.favoriteLocationIds.filter((id) => id !== locationId);
            this.renderFavoritesSummary();
            this.syncFavoriteButtons();
            this.setStatus(`Local #${locationId} eliminado de favoritos.`);
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async saveAddress(event) {
        event.preventDefault();

        if (!this.authenticatedValue) {
            this.setAddressStatus('Inicia sesión para guardar direcciones.');
            return;
        }

        const payload = {
            label: this.addressLabelInputTarget.value.trim(),
            city: this.addressCityInputTarget.value.trim() || null,
            state: this.addressStateInputTarget.value.trim() || null,
            reference: this.addressReferenceInputTarget.value.trim() || null,
            latitude: this.normalizeOptionalCoordinate(this.addressLatInputTarget.value),
            longitude: this.normalizeOptionalCoordinate(this.addressLngInputTarget.value),
            is_primary: this.addressPrimaryInputTarget.checked,
        };

        if (!payload.label) {
            this.setAddressStatus('Captura una etiqueta para la dirección.');
            return;
        }

        try {
            await this.requestJson(this.addressesUrlValue, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            await this.refreshAddresses();
            this.resetAddressForm();
            this.setAddressStatus(`Dirección "${payload.label}" guardada correctamente.`);
            this.setStatus('Dirección guardada en tu cuenta.');
        } catch (error) {
            this.setAddressStatus(error.message);
        }
    }

    async loadFeed() {
        this.setStatus('Cargando feed canónico...');

        const url = new URL(this.feedUrlValue, window.location.origin);
        if (this.hasUserCoordinates()) {
            url.searchParams.set('lat', String(this.latValue));
            url.searchParams.set('lng', String(this.lngValue));
        }

        try {
            const response = await fetch(url.toString(), {
                headers: {
                    Accept: 'application/json',
                },
            });

            const payload = await response.json();
            const canonicalLocations = Array.isArray(payload.data) ? payload.data : [];
            let locations = canonicalLocations;
            this.currentFeedSource = 'canonical';

            if (this.shouldFetchGooglePlaces()) {
                const googleLocations = await this.fetchNearbyPlacesFallback();
                if (googleLocations.length > 0) {
                    locations = this.mergeLocationsWithGooglePlaces(canonicalLocations, googleLocations);
                    this.currentFeedSource = canonicalLocations.length > 0 ? 'hybrid' : 'places_fallback';
                }
            }

            this.currentLocations = locations;
            this.renderCategoryChips(locations);
            const filteredLocations = this.filteredLocations(locations);
            this.visibleLocations = filteredLocations;
            const selectedLocation = filteredLocations.find((location) => this.locationKey(location) === this.selectedLocationId) ?? filteredLocations[0] ?? null;
            this.selectedLocationId = selectedLocation ? this.locationKey(selectedLocation) : null;

            this.countTarget.textContent = String(filteredLocations.length);
            this.renderList(filteredLocations);
            await this.renderCanvas(filteredLocations);
            this.syncFavoriteButtons();
            this.syncActiveCard();

            if (payload.errors && payload.errors.length > 0) {
                this.setStatus(payload.errors[0]);
                return;
            }

            if (this.currentFeedSource === 'places_fallback') {
                this.setStatus(locations.length > 0
                    ? 'Explora locales cercanos.'
                    : 'No encontré lugares cercanos.');
                return;
            }

            this.setStatus(locations.length > 0 ? 'Explora locales cercanos.' : 'Aún no hay locales visibles.');
        } catch (error) {
            this.setStatus(`No se pudo cargar el feed: ${error.message}`);
            if (this.hasListTarget) {
                this.listTarget.innerHTML = '<div class="map-shell__empty">No se pudo cargar el feed.</div>';
            }
            this.canvasTarget.innerHTML = '';
        }
    }

    async applyCategoryFilter(event) {
        const nextFilter = event.currentTarget.dataset.categoryFilter ?? 'all';
        this.activeCategoryFilter = nextFilter;
        this.renderCategoryChips();

        this.visibleLocations = this.filteredLocations(this.currentLocations);
        const selectedStillVisible = this.visibleLocations.find((location) => this.locationKey(location) === this.selectedLocationId);
        if (!selectedStillVisible) {
            this.selectedLocationId = this.visibleLocations[0] ? this.locationKey(this.visibleLocations[0]) : null;
        }

        this.countTarget.textContent = String(this.visibleLocations.length);
        this.renderList(this.visibleLocations);
        await this.renderCanvas(this.visibleLocations);
        this.syncFavoriteButtons();
        this.syncActiveCard();
        if (this.visibleLocations.length === 0) {
            this.setStatus('No encontré locales para esa categoría.');
        }
    }

    renderList(locations) {
        if (!this.hasListTarget) {
            return;
        }

        if (locations.length === 0) {
            this.listTarget.innerHTML = '<div class="map-shell__empty">Todavía no hay puntos visibles.</div>';
            return;
        }

        this.listTarget.innerHTML = locations.map((location, index) => `
            <article
                class="mobile-map-card ${this.locationKey(location) === this.selectedLocationId ? 'is-active' : ''}"
                data-index="${index}"
                data-action="click->map-shell#focusLocation"
                data-location-key="${this.escapeHtml(this.locationKey(location))}"
                data-card-location-key="${this.escapeHtml(this.locationKey(location))}"
            >
                <div class="mobile-map-card__media mobile-map-card__media--${this.mediaTone(location)} ${location.photo_url ? 'has-photo' : ''}" ${this.mediaStyle(location)}>
                    ${this.canFavorite(location) ? this.favoriteButtonMarkup(Number(location.location_id)) : ''}
                    <span class="mobile-map-card__source-badge ${this.sourceBadgeClass(location)}">${this.escapeHtml(this.sourceTypeLabel(location.source_type))}</span>
                    <div class="mobile-map-card__distance">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 3.5 19 7v10l-7 3.5L5 17V7l7-3.5Z"></path>
                            <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"></path>
                        </svg>
                        ${this.formatDistance(location.distance_meters)}
                    </div>
                    <div class="mobile-map-card__media-copy">
                        <span>${this.escapeHtml((location.merchant_name ?? 'M').slice(0, 1).toUpperCase())}</span>
                    </div>
                </div>
                <div class="mobile-map-card__body">
                    <h3>${this.escapeHtml(location.location_name ?? 'Sin nombre')}</h3>
                    <p>${this.escapeHtml(this.cardSubtitle(location))}</p>
                    <div class="mobile-map-card__meta">
                        <span class="mobile-map-card__status ${this.publicationStatusClass(location)}">${this.escapeHtml(this.publicationStatusLabel(location))}</span>
                        <span class="mobile-map-card__reviews">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m12 3.8 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.1 6.8 19.8l1-5.8-4.2-4.1 5.8-.8L12 3.8Z"></path>
                            </svg>
                            ${this.escapeHtml(this.reviewsLabel(location))}
                        </span>
                    </div>
                </div>
            </article>
        `).join('');
    }

    async renderCanvas(locations, options = {}) {
        if (this.googleMapsApiKeyValue && this.googleMapsApiKeyValue.trim() !== '') {
            try {
                await this.renderGoogleMap(locations, options);
                return;
            } catch (error) {
                this.setCanvasNote(`Google Maps no se pudo inicializar: ${error.message}`);
            }
        } else {
            this.setCanvasNote('GOOGLE_MAPS_API_KEY no está configurado. Se muestra la vista fallback.');
        }

        this.googleMapsReady = false;
        this.renderFallbackCanvas(locations);
    }

    filteredLocations(locations) {
        if (this.activeCategoryFilter === 'all') {
            return locations;
        }

        return locations.filter((location) => this.locationCategory(location) === this.activeCategoryFilter);
    }

    renderCategoryChips(locations = this.currentLocations) {
        if (!this.hasChipRowTarget) {
            return;
        }

        const categoryKeys = this.availableCategoryKeys(locations);
        if (!categoryKeys.includes(this.activeCategoryFilter)) {
            this.activeCategoryFilter = 'all';
        }

        this.chipRowTarget.innerHTML = categoryKeys.map((categoryKey) => {
            const label = categoryKey === 'all'
                ? 'Todos'
                : (this.categoryDefinitions[categoryKey]?.label ?? categoryKey);

            return `
                <button
                    type="button"
                    class="mobile-map-app__chip ${categoryKey === this.activeCategoryFilter ? 'is-active' : ''}"
                    data-map-shell-target="categoryChip"
                    data-category-filter="${this.escapeHtml(categoryKey)}"
                    data-action="map-shell#applyCategoryFilter"
                >
                    ${this.escapeHtml(label)}
                </button>
            `;
        }).join('');
    }

    availableCategoryKeys(locations) {
        const discoveredCategories = new Set();

        locations.forEach((location) => {
            const category = this.locationCategory(location);
            if (category !== 'all') {
                discoveredCategories.add(category);
            }
        });

        return ['all', ...Object.keys(this.categoryDefinitions).filter((key) => discoveredCategories.has(key))];
    }

    shouldFetchGooglePlaces() {
        return this.hasUserCoordinates() && this.googleMapsApiKeyValue && this.googleMapsApiKeyValue.trim() !== '';
    }

    mergeLocationsWithGooglePlaces(canonicalLocations, googleLocations) {
        if (!Array.isArray(canonicalLocations) || canonicalLocations.length === 0) {
            return googleLocations;
        }

        const merged = [...canonicalLocations];

        googleLocations.forEach((googleLocation) => {
            const duplicate = canonicalLocations.some((canonicalLocation) => this.isSamePhysicalLocation(canonicalLocation, googleLocation));
            if (!duplicate) {
                merged.push(googleLocation);
            }
        });

        return merged;
    }

    isSamePhysicalLocation(left, right) {
        const leftLat = Number(left.lat);
        const leftLng = Number(left.lng);
        const rightLat = Number(right.lat);
        const rightLng = Number(right.lng);

        if (Number.isFinite(leftLat) && Number.isFinite(leftLng) && Number.isFinite(rightLat) && Number.isFinite(rightLng)) {
            return this.distanceMeters(leftLat, leftLng, rightLat, rightLng) <= 60;
        }

        const leftName = this.normalizeComparisonText(left.location_name ?? left.merchant_name ?? '');
        const rightName = this.normalizeComparisonText(right.location_name ?? right.merchant_name ?? '');
        const leftAddress = this.normalizeComparisonText(left.short_address ?? '');
        const rightAddress = this.normalizeComparisonText(right.short_address ?? '');

        return leftName !== '' && leftName === rightName && leftAddress !== '' && leftAddress === rightAddress;
    }

    renderFallbackCanvas(locations) {
        if (locations.length === 0) {
            this.canvasTarget.innerHTML = '<div class="map-shell__canvas-empty">Sin puntos que dibujar</div>';
            return;
        }

        const points = locations.map((location, index) => {
            const x = ((index * 19) % 70) + 12;
            const y = ((index * 13) % 58) + 18;

            return `
                <button
                    type="button"
                    class="map-shell__pin"
                    style="left:${x}%; top:${y}%;"
                    title="${location.location_name ?? 'Local'}"
                >
                    <span>${index + 1}</span>
                </button>
            `;
        }).join('');

        this.canvasTarget.innerHTML = `
            <div class="map-shell__grid"></div>
            ${points}
        `;
    }

    setStatus(message) {
        this.statusTarget.textContent = message;
    }

    async refreshAddresses() {
        const payload = await this.requestJson(this.addressesUrlValue, { method: 'GET' });
        this.savedAddresses = Array.isArray(payload.data) ? payload.data : [];
        this.renderAddressesSummary();
    }

    renderFavoritesSummary() {
        const count = String(this.favoriteLocationIds.length);

        if (this.hasFavoritesCountTarget) {
            this.favoritesCountTarget.textContent = count;
        }
        if (this.hasFavoritesCountDuplicateTarget) {
            this.favoritesCountDuplicateTarget.textContent = count;
        }
        if (this.hasFavoritesListTarget) {
            if (this.favoriteLocationIds.length === 0) {
                this.favoritesListTarget.innerHTML = '<div class="public-home__empty-card">Todavía no has guardado ningún local.</div>';
                return;
            }

            this.favoritesListTarget.innerHTML = this.favoriteLocationIds
                .slice()
                .sort((left, right) => right - left)
                .map((locationId) => `
                    <article class="public-home__saved-row">
                        <div>
                            <strong>Local #${locationId}</strong>
                            <p>Guardado desde la exploración pública.</p>
                        </div>
                        <button
                            type="button"
                            class="public-home__inline-button"
                            data-action="map-shell#removeFavoriteFromList"
                            data-location-id="${locationId}"
                        >
                            Quitar
                        </button>
                    </article>
                `)
                .join('');
        }
    }

    renderAddressesSummary() {
        const count = String(this.savedAddresses.length);

        if (this.hasAddressesCountTarget) {
            this.addressesCountTarget.textContent = count;
        }
        if (this.hasAddressesCountDuplicateTarget) {
            this.addressesCountDuplicateTarget.textContent = count;
        }
        if (this.hasAddressesListTarget) {
            if (this.savedAddresses.length === 0) {
                this.addressesListTarget.innerHTML = '<div class="public-home__empty-card">Todavía no tienes direcciones guardadas.</div>';
                return;
            }

            this.addressesListTarget.innerHTML = this.savedAddresses.map((address) => `
                <article class="public-home__saved-row">
                    <div>
                        <strong>${address.label ?? 'Sin etiqueta'}</strong>
                        <p>${this.addressLine(address)}</p>
                    </div>
                    ${address.is_primary ? '<span class="public-home__badge">Principal</span>' : ''}
                </article>
            `).join('');
        }
    }

    syncFavoriteButtons() {
        this.element.querySelectorAll('[data-location-id]').forEach((element) => {
            const locationId = Number.parseInt(element.dataset.locationId ?? '', 10);
            if (Number.isNaN(locationId) || !element.classList.contains('mobile-map-card__heart')) {
                return;
            }

            const isFavorite = this.favoriteLocationIds.includes(locationId);
            element.classList.toggle('is-active', isFavorite);
        });
    }

    async renderGoogleMap(locations, options = {}) {
        const google = await this.loadGoogleMaps();
        await this.afterLayoutSettles();

        if (!this.map) {
            this.canvasTarget.innerHTML = '';
            this.map = new google.maps.Map(this.canvasTarget, {
                center: { lat: 19.432608, lng: -99.133209 },
                zoom: 12,
                mapTypeId: this.currentMapTypeId,
                disableDefaultUI: true,
                clickableIcons: false,
                gestureHandling: 'greedy',
                styles: [
                    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
                    { featureType: 'transit.station', stylers: [{ saturation: -40 }] },
                    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#b3c3d4' }] },
                    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#425466' }] },
                    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d9eef9' }] },
                    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f8f3e8' }] },
                ],
            });
            this.infoWindow = new google.maps.InfoWindow();
            this.initializeMapDiscoveryListener(google);
        }

        this.map.setMapTypeId(this.currentMapTypeId);

        this.isSyncingMapViewport = true;
        this.markers.forEach((marker) => marker.setMap(null));
        this.markers = [];
        if (this.userMarker) {
            this.userMarker.setMap(null);
            this.userMarker = null;
        }

        const validLocations = locations.filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng));
        const hasUserCoordinates = this.hasUserCoordinates();
        if (validLocations.length === 0) {
            if (hasUserCoordinates) {
                const userPosition = this.currentUserPosition();
                this.userMarker = new google.maps.Marker({
                    map: this.map,
                    position: userPosition,
                    title: 'Tu ubicación',
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 9,
                        fillColor: '#f27f0d',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 3,
                    },
                });
                this.map.setCenter(userPosition);
                this.map.setZoom(14);
                this.rememberCurrentMapCenter();
                this.isSyncingMapViewport = false;
                this.setCanvasNote(locations.length === 0
                    ? 'Ya ubicamos tu zona, pero todavía no hay locales visibles publicados.'
                    : 'Ubicamos tu zona, pero los locales visibles aún no traen coordenadas publicadas.');
                return;
            }

            this.map.setCenter({ lat: 19.432608, lng: -99.133209 });
            this.map.setZoom(11);
            this.rememberCurrentMapCenter();
            this.isSyncingMapViewport = false;
            this.setCanvasNote(locations.length === 0
                ? 'Todavía no hay locales visibles publicados en el feed.'
                : 'El feed devolvió locales, pero todavía no tienen coordenadas válidas para dibujarse.');
            return;
        }

        const bounds = new google.maps.LatLngBounds();

        validLocations.forEach((location) => {
            const position = { lat: Number(location.lat), lng: Number(location.lng) };
            const marker = new google.maps.Marker({
                map: this.map,
                position,
                title: location.location_name ?? 'Local',
                animation: google.maps.Animation.DROP,
            });

            marker.addListener('click', async () => {
                this.setSelectedLocation(this.locationKey(location));
                const enrichedLocation = await this.enrichLocationIfNeeded(location);
                this.openInfoWindow(enrichedLocation, marker);
            });

            this.markers.push(marker);
            bounds.extend(position);
        });

        if (hasUserCoordinates) {
            const userPosition = this.currentUserPosition();
            this.userMarker = new google.maps.Marker({
                map: this.map,
                position: userPosition,
                title: 'Tu ubicación',
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 9,
                    fillColor: '#f27f0d',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 3,
                },
            });
            bounds.extend(userPosition);
        }

        if (options.preserveViewport) {
            // Keep the user's current viewport while augmenting nearby discoveries.
        } else if (hasUserCoordinates && validLocations.length > 0) {
            this.map.fitBounds(bounds, 60);
        } else if (hasUserCoordinates) {
            this.map.setCenter(this.currentUserPosition());
            this.map.setZoom(15);
        } else if (validLocations.length === 1) {
            this.map.setCenter(bounds.getCenter());
            this.map.setZoom(15);
        } else {
            this.map.fitBounds(bounds, 60);
        }

        this.googleMapsReady = true;
        this.refreshMapViewport();
        this.rememberCurrentMapCenter();
        window.setTimeout(() => {
            this.isSyncingMapViewport = false;
        }, 180);
        this.setCanvasNote('');
    }

    focusMapLocation(location) {
        const marker = this.markers.find((candidate) => {
            const position = candidate.getPosition();
            return position
                && Math.abs(position.lat() - Number(location.lat)) < 0.000001
                && Math.abs(position.lng() - Number(location.lng)) < 0.000001;
        });

        if (!marker || !this.map) {
            return;
        }

        this.isSyncingMapViewport = true;
        this.map.panTo(marker.getPosition());
        this.map.setZoom(16);
        this.openInfoWindow(location, marker);
        window.setTimeout(() => {
            this.rememberCurrentMapCenter();
            this.isSyncingMapViewport = false;
        }, 180);
    }

    openInfoWindow(location, marker) {
        if (!this.infoWindow) {
            return;
        }

        this.infoWindow.setContent(this.infoWindowMarkup(location));
        this.infoWindow.open({
            anchor: marker,
            map: this.map,
        });
        this.setStatus(`Mostrando ${location.location_name ?? 'local seleccionado'} en el mapa.`);
    }

    initializeMapDiscoveryListener(google) {
        if (!this.map) {
            return;
        }

        google.maps.event.addListener(this.map, 'idle', () => {
            if (this.mapIdleTimer) {
                window.clearTimeout(this.mapIdleTimer);
            }

            this.mapIdleTimer = window.setTimeout(() => {
                this.discoverPlacesFromViewport();
            }, 420);
        });
    }

    async discoverPlacesFromViewport() {
        if (!this.map || this.isSyncingMapViewport || this.isDiscoveringPlaces || !this.shouldFetchGooglePlaces()) {
            return;
        }

        const center = this.map.getCenter();
        if (!center) {
            return;
        }

        const centerPosition = {
            lat: center.lat(),
            lng: center.lng(),
        };

        if (this.lastDiscoveryCenter) {
            const traveledMeters = this.distanceMeters(
                this.lastDiscoveryCenter.lat,
                this.lastDiscoveryCenter.lng,
                centerPosition.lat,
                centerPosition.lng,
            );

            if (traveledMeters < 320) {
                return;
            }
        }

        this.isDiscoveringPlaces = true;

        try {
            const googleLocations = await this.fetchNearbyPlacesFallback(centerPosition);
            if (googleLocations.length === 0) {
                this.lastDiscoveryCenter = centerPosition;
                return;
            }

            const mergedLocations = this.mergeLocationsWithGooglePlaces(this.currentLocations, googleLocations);
            if (mergedLocations.length === this.currentLocations.length) {
                this.lastDiscoveryCenter = centerPosition;
                return;
            }

            this.currentLocations = mergedLocations;
            this.currentFeedSource = mergedLocations.some((location) => location.source_type !== 'google_places')
                ? 'hybrid'
                : 'places_fallback';
            this.renderCategoryChips(mergedLocations);
            this.visibleLocations = this.filteredLocations(mergedLocations);
            this.countTarget.textContent = String(this.visibleLocations.length);
            this.renderList(this.visibleLocations);
            await this.renderCanvas(this.visibleLocations, { preserveViewport: true });
            this.syncFavoriteButtons();
            this.syncActiveCard();
            this.lastDiscoveryCenter = centerPosition;
            this.setStatus('Descubrimos más locales en esta zona del mapa.');
        } catch (error) {
            this.setStatus(`No pude descubrir más locales en esta zona: ${error.message}`);
        } finally {
            this.isDiscoveringPlaces = false;
        }
    }

    rememberCurrentMapCenter() {
        if (!this.map) {
            return;
        }

        const center = this.map.getCenter();
        if (!center) {
            return;
        }

        this.lastDiscoveryCenter = {
            lat: center.lat(),
            lng: center.lng(),
        };
    }

    async loadGoogleMaps() {
        if (window.google?.maps) {
            this.googleMapsReady = true;
            return window.google;
        }

        if (window.__miMonchisGoogleMapsPromise) {
            await window.__miMonchisGoogleMapsPromise;
            this.googleMapsReady = true;
            return window.google;
        }

        window.__miMonchisGoogleMapsPromise = new Promise((resolve, reject) => {
            const callbackName = '__miMonchisInitGoogleMaps';
            const existingScript = document.querySelector('script[data-google-maps-loader="true"]');
            if (existingScript) {
                if (window.google?.maps) {
                    resolve(window.google);
                    return;
                }

                if (existingScript.dataset.loaded === 'true') {
                    reject(new Error('Google Maps ya marcó el script como cargado, pero window.google.maps no está disponible.'));
                    return;
                }

                existingScript.addEventListener('load', () => resolve(window.google));
                existingScript.addEventListener('error', () => reject(new Error('No se pudo cargar el script de Google Maps.')));
                return;
            }

            window[callbackName] = () => {
                script.dataset.loaded = 'true';
                resolve(window.google);
                delete window[callbackName];
            };

            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(this.googleMapsApiKeyValue)}&callback=${callbackName}&loading=async&libraries=places&language=es&region=MX`;
            script.async = true;
            script.defer = true;
            script.dataset.googleMapsLoader = 'true';
            script.onerror = () => {
                reject(new Error('La carga remota de Google Maps falló.'));
                delete window[callbackName];
            };
            document.head.appendChild(script);
        });

        await window.__miMonchisGoogleMapsPromise;
        this.googleMapsReady = true;
        return window.google;
    }

    initializeWalkthrough() {
        if (!this.hasWalkthroughTarget || !this.walkthroughEnabledValue || this.hasSeenWalkthrough()) {
            if (this.hasWalkthroughTarget) {
                this.walkthroughTarget.classList.add('is-hidden');
            }

            return false;
        }

        this.walkthroughTarget.classList.remove('is-hidden');
        this.walkthroughTarget.classList.add('is-visible');
        this.runWalkthroughSequence();
        return true;
    }

    runWalkthroughSequence() {
        const message = '¿estás listo para explorar tu antojo?';
        let index = 0;

        const typeNextCharacter = () => {
            if (!this.hasWalkthroughCopyTarget) {
                return;
            }

            this.walkthroughCopyTarget.textContent = message.slice(0, index);

            if (index < message.length) {
                index += 1;
                this.walkthroughTypingTimer = window.setTimeout(typeNextCharacter, 52);
                return;
            }

            window.setTimeout(() => {
                this.walkthroughFormTarget.classList.remove('is-hidden');
                this.walkthroughFormTarget.classList.add('is-visible');
            }, 160);

            window.setTimeout(() => {
                this.walkthroughGeoButtonTarget.classList.remove('is-hidden');
                this.walkthroughGeoButtonTarget.classList.add('is-visible');
            }, 560);

            window.setTimeout(() => {
                this.walkthroughLogoTarget.classList.remove('is-hidden');
                this.walkthroughLogoTarget.classList.add('is-visible');
            }, 980);
        };

        typeNextCharacter();
    }

    hasSeenWalkthrough() {
        try {
            return window.localStorage.getItem('mi_monchis_walkthrough_seen') === '1';
        } catch (error) {
            return false;
        }
    }

    async completeWalkthrough() {
        try {
            window.localStorage.setItem('mi_monchis_walkthrough_seen', '1');
        } catch (error) {
            // Ignore localStorage issues for demo mode.
        }

        if (!this.hasWalkthroughTarget) {
            return;
        }

        this.walkthroughTarget.classList.remove('is-visible');
        this.walkthroughTarget.classList.add('is-leaving');

        await new Promise((resolve) => window.setTimeout(resolve, 420));
        this.walkthroughTarget.classList.add('is-hidden');
        this.walkthroughTarget.classList.remove('is-leaving');
        await this.afterLayoutSettles();
    }

    async fetchPlacePredictions(query) {
        const google = await this.loadGoogleMaps();
        if (!google.maps.places?.AutocompleteService) {
            throw new Error('La librería de Places no está disponible. Activa Places API para usar sugerencias de dirección.');
        }

        const service = this.autocompleteService ?? new google.maps.places.AutocompleteService();
        this.autocompleteService = service;

        return new Promise((resolve, reject) => {
            service.getPlacePredictions({
                input: query,
                componentRestrictions: { country: 'mx' },
                types: ['geocode'],
                language: 'es',
            }, (predictions, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(predictions)) {
                    resolve(predictions.slice(0, 5).map((prediction) => ({
                        description: prediction.description ?? '',
                        placeId: prediction.place_id ?? '',
                        primaryText: prediction.structured_formatting?.main_text ?? '',
                        secondaryText: prediction.structured_formatting?.secondary_text ?? '',
                    })));
                    return;
                }

                if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                    resolve([]);
                    return;
                }

                reject(new Error(this.googlePlacesStatusMessage(status)));
            });
        });
    }

    async fetchPlaceDetails(placeId) {
        const google = await this.loadGoogleMaps();
        const service = this.googlePlacesService(google);

        return new Promise((resolve, reject) => {
            service.getDetails({
                placeId,
                fields: ['geometry.location', 'formatted_address'],
                language: 'es',
                region: 'MX',
            }, (place, status) => {
                if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) {
                    reject(new Error(this.googlePlacesStatusMessage(status)));
                    return;
                }

                resolve({
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                });
            });
        });
    }

    async fetchGooglePlaceEnrichment(placeId) {
        const google = await this.loadGoogleMaps();
        const service = this.googlePlacesService(google);

        return new Promise((resolve, reject) => {
            service.getDetails({
                placeId,
                fields: [
                    'current_opening_hours',
                    'formatted_address',
                    'formatted_phone_number',
                    'geometry.location',
                    'name',
                    'opening_hours',
                    'photos',
                    'rating',
                    'reviews',
                    'types',
                    'user_ratings_total',
                    'website',
                ],
                language: 'es',
                region: 'MX',
            }, (place, status) => {
                if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
                    reject(new Error(this.googlePlacesStatusMessage(status)));
                    return;
                }

                const lat = place.geometry?.location?.lat?.();
                const lng = place.geometry?.location?.lng?.();
                const photoUrl = Array.isArray(place.photos) && place.photos[0]?.getUrl
                    ? place.photos[0].getUrl({ maxWidth: 1400, maxHeight: 1000 })
                    : null;

                resolve({
                    lat: Number.isFinite(lat) ? Number(lat) : null,
                    lng: Number.isFinite(lng) ? Number(lng) : null,
                    short_address: place.formatted_address ?? null,
                    open_now: typeof place.current_opening_hours?.open_now === 'boolean'
                        ? place.current_opening_hours.open_now
                        : (typeof place.opening_hours?.open_now === 'boolean' ? place.opening_hours.open_now : null),
                    opening_hours_text: Array.isArray(place.current_opening_hours?.weekday_text)
                        ? place.current_opening_hours.weekday_text
                        : (Array.isArray(place.opening_hours?.weekday_text) ? place.opening_hours.weekday_text : []),
                    rating: typeof place.rating === 'number' ? place.rating : null,
                    user_ratings_total: typeof place.user_ratings_total === 'number' ? place.user_ratings_total : null,
                    photo_url: photoUrl,
                    types: Array.isArray(place.types) ? place.types : [],
                    google_reviews: Array.isArray(place.reviews) ? place.reviews.slice(0, 3).map((review) => ({
                        author_name: review.author_name ?? 'Google',
                        rating: typeof review.rating === 'number' ? review.rating : null,
                        text: review.text ?? '',
                    })) : [],
                    google_phone_number: place.formatted_phone_number ?? null,
                    google_website: place.website ?? null,
                });
            });
        });
    }

    googlePlacesService(google = window.google) {
        if (!google?.maps?.places?.PlacesService) {
            throw new Error('La librería de Places no está disponible. Activa Places API para usar sugerencias de dirección.');
        }

        const serviceNode = this.placeDetailsNode ?? document.createElement('div');
        this.placeDetailsNode = serviceNode;
        const service = this.placeDetailsService ?? new google.maps.places.PlacesService(serviceNode);
        this.placeDetailsService = service;
        return service;
    }

    async fetchNearbyPlacesFallback(searchCenter = null) {
        const google = await this.loadGoogleMaps();
        if (!google.maps.places?.PlacesService || !this.hasUserCoordinates()) {
            return [];
        }

        const serviceNode = this.nearbyPlacesNode ?? document.createElement('div');
        this.nearbyPlacesNode = serviceNode;
        const service = this.nearbyPlacesService ?? new google.maps.places.PlacesService(serviceNode);
        this.nearbyPlacesService = service;
        const userPosition = this.currentUserPosition();
        const center = searchCenter && Number.isFinite(searchCenter.lat) && Number.isFinite(searchCenter.lng)
            ? searchCenter
            : userPosition;

        return new Promise((resolve, reject) => {
            service.nearbySearch({
                location: center,
                radius: 2200,
                type: 'restaurant',
                language: 'es',
            }, (results, status) => {
                if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                    resolve([]);
                    return;
                }

                if (status !== google.maps.places.PlacesServiceStatus.OK || !Array.isArray(results)) {
                    reject(new Error(this.googlePlacesStatusMessage(status)));
                    return;
                }

                resolve(results.slice(0, 10).map((place, index) => {
                    const lat = place.geometry?.location?.lat?.();
                    const lng = place.geometry?.location?.lng?.();
                    const photoUrl = Array.isArray(place.photos) && place.photos[0]?.getUrl
                        ? place.photos[0].getUrl({ maxWidth: 1200, maxHeight: 900 })
                        : null;

                    return {
                        selection_key: `place:${place.place_id ?? index}`,
                        place_id: place.place_id ?? null,
                        location_id: null,
                        merchant_name: place.name ?? 'Lugar cercano',
                        location_name: place.name ?? 'Lugar cercano',
                        lat: Number(lat),
                        lng: Number(lng),
                        short_address: place.vicinity ?? 'Dirección no disponible',
                        distance_meters: Number.isFinite(lat) && Number.isFinite(lng)
                            ? this.distanceMeters(userPosition.lat, userPosition.lng, Number(lat), Number(lng))
                            : null,
                        whatsapp_enabled: false,
                        whatsapp_e164: null,
                        source_type: 'google_places',
                        publication_state: 'fallback_visible',
                        open_now: place.opening_hours?.open_now ?? null,
                        rating: typeof place.rating === 'number' ? place.rating : null,
                        user_ratings_total: typeof place.user_ratings_total === 'number' ? place.user_ratings_total : null,
                        types: Array.isArray(place.types) ? place.types : [],
                        photo_url: photoUrl,
                    };
                }).filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng)));
            });
        });
    }

    async resolveWalkthroughSelection(address) {
        if (this.walkthroughSelection && this.walkthroughAddressInputTarget.value.trim() === this.walkthroughSelection.description) {
            return this.walkthroughSelection;
        }

        const predictions = this.walkthroughPredictions.length > 0
            ? this.walkthroughPredictions
            : await this.fetchPlacePredictions(address);

        if (predictions.length === 0) {
            throw new Error('No encontré una colonia o dirección coincidente. Intenta con calle, número o colonia.');
        }

        const firstPrediction = predictions[0];
        const details = await this.fetchPlaceDetails(firstPrediction.placeId);

        this.walkthroughAddressInputTarget.value = firstPrediction.description;

        return {
            lat: details.lat,
            lng: details.lng,
            label: firstPrediction.primaryText || firstPrediction.description,
            description: firstPrediction.description,
            placeId: firstPrediction.placeId,
        };
    }

    requestGeolocation() {
        if (!('geolocation' in navigator)) {
            throw new Error('Tu navegador no soporta geolocalización.');
        }

        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => resolve(position.coords),
                (error) => reject(error),
                {
                    enableHighAccuracy: true,
                    timeout: 8000,
                    maximumAge: 60000,
                },
            );
        });
    }

    applyCoordinates(latitude, longitude) {
        if (this.hasAddressLatInputTarget) {
            this.addressLatInputTarget.value = Number(latitude).toFixed(6);
        }
        if (this.hasAddressLngInputTarget) {
            this.addressLngInputTarget.value = Number(longitude).toFixed(6);
        }

        this.latValue = Number(latitude);
        this.lngValue = Number(longitude);
        this.persistLocationContext();
    }

    setWalkthroughError(message) {
        if (!this.hasWalkthroughErrorTarget) {
            return;
        }

        if (message === '') {
            this.walkthroughErrorTarget.textContent = '';
            this.walkthroughErrorTarget.classList.add('is-hidden');
            return;
        }

        this.walkthroughErrorTarget.textContent = message;
        this.walkthroughErrorTarget.classList.remove('is-hidden');
    }

    renderWalkthroughSuggestions() {
        if (!this.hasWalkthroughSuggestionsTarget) {
            return;
        }

        if (this.walkthroughPredictions.length === 0) {
            this.hideWalkthroughSuggestions();
            return;
        }

        const selectedPlaceId = this.walkthroughSelection?.description === this.walkthroughAddressInputTarget.value.trim()
            ? this.walkthroughSelection?.placeId
            : null;

        this.walkthroughSuggestionsTarget.innerHTML = this.walkthroughPredictions.map((prediction) => `
            <button
                type="button"
                class="welcome-flow__suggestion ${prediction.placeId === selectedPlaceId ? 'is-active' : ''}"
                data-action="mousedown->map-shell#selectWalkthroughSuggestion"
                data-place-id="${this.escapeHtml(prediction.placeId)}"
            >
                <span class="welcome-flow__suggestion-main">${this.escapeHtml(prediction.primaryText || prediction.description)}</span>
                <span class="welcome-flow__suggestion-secondary">${this.escapeHtml(prediction.secondaryText || '')}</span>
            </button>
        `).join('');
        this.walkthroughSuggestionsTarget.classList.remove('is-hidden');
    }

    hideWalkthroughSuggestions() {
        if (!this.hasWalkthroughSuggestionsTarget) {
            return;
        }

        this.walkthroughSuggestionsTarget.innerHTML = '';
        this.walkthroughSuggestionsTarget.classList.add('is-hidden');
    }

    updateHeroLocation(label) {
        if (this.hasHeroLocationTarget && label) {
            this.heroLocationTarget.textContent = label;
        }

        if (label) {
            this.currentLocationLabel = label;
            this.persistLocationContext();
        }
    }

    googlePlacesStatusMessage(status) {
        const normalizedStatus = String(status ?? '').toUpperCase();

        if (normalizedStatus === 'REQUEST_DENIED') {
            return 'Tu API key sí carga el mapa, pero no tiene autorizado Places API. Actívalo en Google Cloud Console y añade Places API a las restricciones de la llave.';
        }

        if (normalizedStatus === 'ZERO_RESULTS') {
            return 'No encontré una colonia o dirección coincidente. Intenta con calle, número o colonia.';
        }

        if (normalizedStatus === 'INVALID_REQUEST') {
            return 'La búsqueda de dirección llegó incompleta. Escribe al menos una colonia, calle o referencia.';
        }

        if (normalizedStatus === 'OVER_QUERY_LIMIT') {
            return 'Google Places alcanzó el límite de consultas para esta llave.';
        }

        return 'No pude obtener sugerencias de dirección desde Google Places.';
    }

    infoWindowMarkup(location) {
        const locationName = this.escapeHtml(location.location_name ?? 'Local sin nombre');
        const merchantName = this.escapeHtml(location.merchant_name ?? 'Merchant');
        const address = this.escapeHtml(location.short_address ?? 'Dirección pendiente');
        const statusLabel = this.escapeHtml(this.publicationStatusLabel(location));
        const statusClass = this.infoWindowStatusClass(location);
        const distanceLabel = location.distance_meters != null ? this.escapeHtml(this.formatDistance(location.distance_meters)) : 'Zona cercana';
        const sourceLabel = this.escapeHtml(this.sourceTypeLabel(location.source_type));
        const directionsUrl = this.buildDirectionsUrl(location);
        const whatsappUrl = this.buildWhatsAppUrl(location.whatsapp_enabled, location.whatsapp_e164);
        const reviewsLabel = this.escapeHtml(this.reviewsLabel(location));
        const sourceBadgeClass = this.sourceBadgeClass(location);
        const hoursSummary = this.openingHoursSummary(location);
        const reviewSnippet = this.reviewSnippet(location);

        return `
            <article class="map-shell__info-window">
                <header class="map-shell__info-window-header">
                    <div>
                        <strong>${locationName}</strong>
                        <p class="map-shell__info-window-merchant">${merchantName}</p>
                    </div>
                    <div class="map-shell__info-window-badge-stack">
                        <span class="map-shell__info-window-badge map-shell__info-window-badge--source ${sourceBadgeClass}">${sourceLabel}</span>
                        <span class="map-shell__info-window-badge ${statusClass}">${statusLabel}</span>
                    </div>
                </header>
                <p class="map-shell__info-window-address">${address}</p>
                <div class="map-shell__info-window-meta">
                    <span>${distanceLabel}</span>
                    <span>${reviewsLabel}</span>
                </div>
                ${hoursSummary ? `<p class="map-shell__info-window-detail">${this.escapeHtml(hoursSummary)}</p>` : ''}
                ${reviewSnippet ? `<p class="map-shell__info-window-review">${this.escapeHtml(reviewSnippet)}</p>` : ''}
                <div class="map-shell__info-window-actions">
                    ${directionsUrl ? `<a href="${this.escapeHtml(directionsUrl)}" target="_blank" rel="noreferrer">Cómo llegar</a>` : ''}
                    ${whatsappUrl ? `<a href="${this.escapeHtml(whatsappUrl)}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''}
                </div>
            </article>
        `;
    }

    publicationStatusLabel(location) {
        if (location.source_type === 'google_places') {
            if (this.locationIsOpen(location) === true) {
                return 'Abierto';
            }

            if (this.locationIsOpen(location) === false) {
                return 'Cerrado';
            }

            return 'Disponible';
        }

        if (location.publication_state === 'public_visible') {
            return 'Disponible';
        }

        if (location.publication_state === 'fallback_visible') {
            return 'Disponible';
        }

        return 'Pendiente';
    }

    publicationStatusClass(location) {
        if (location.source_type === 'google_places') {
            if (this.locationIsOpen(location) === false) {
                return 'mobile-map-card__status--closed';
            }

            return 'mobile-map-card__status--discovered';
        }

        if (location.publication_state === 'public_visible') {
            return ''; // Default green
        }

        if (location.publication_state === 'fallback_visible') {
            return 'mobile-map-card__status--discovered';
        }

        // For 'pending_visible' or any other state
        return 'mobile-map-card__status--pending';
    }

    sourceTypeLabel(sourceType) {
        if (sourceType === 'owner_registered') {
            return 'Real';
        }

        if (sourceType === 'fake_seed') {
            return 'Demo';
        }

        if (sourceType === 'google_places') {
            return 'Google';
        }

        return 'Mi Monchis';
    }

    sourceBadgeClass(location) {
        if (location.source_type === 'owner_registered') {
            return 'source-badge--real';
        }

        if (location.source_type === 'fake_seed') {
            return 'source-badge--demo';
        }

        if (location.source_type === 'google_places') {
            return 'source-badge--google';
        }

        return 'source-badge--default';
    }

    infoWindowStatusClass(location) {
        if (location.source_type === 'google_places' && this.locationIsOpen(location) === false) {
            return 'map-shell__info-window-badge--closed';
        }

        return 'map-shell__info-window-badge--open';
    }

    locationCategory(location) {
        const types = Array.isArray(location.types) ? location.types.map((type) => String(type).toLowerCase()) : [];

        if (types.some((type) => ['meal_takeaway', 'mexican_restaurant', 'taco_restaurant'].includes(type))) {
            return 'taqueria';
        }

        if (types.some((type) => ['vegetarian_restaurant', 'vegan_restaurant'].includes(type))) {
            return 'vegetariano';
        }

        if (types.some((type) => ['cafe', 'bakery', 'coffee_shop'].includes(type))) {
            return 'cafeteria';
        }

        if (types.some((type) => ['restaurant', 'food', 'meal_delivery'].includes(type))) {
            return 'restaurante';
        }

        const haystack = [
            location.location_name,
            location.merchant_name,
            location.short_address,
            location.source_type,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        if (haystack.includes('taco') || haystack.includes('taquer')) {
            return 'taqueria';
        }

        if (haystack.includes('veggie') || haystack.includes('vegetar') || haystack.includes('vegano') || haystack.includes('ensalada')) {
            return 'vegetariano';
        }

        if (haystack.includes('cafe') || haystack.includes('cafeter') || haystack.includes('coffee')) {
            return 'cafeteria';
        }

        return 'all';
    }

    buildDirectionsUrl(location) {
        const lat = Number(location.lat);
        const lng = Number(location.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return null;
        }

        const destination = `${lat},${lng}`;
        const origin = this.hasUserCoordinates()
            ? `&origin=${encodeURIComponent(`${this.latValue},${this.lngValue}`)}`
            : '';

        return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${origin}`;
    }

    buildWhatsAppUrl(isEnabled, e164) {
        if (!isEnabled || !e164) {
            return null;
        }

        const phone = String(e164).replace(/\D/g, '');
        if (phone === '') {
            return null;
        }

        return `https://wa.me/${phone}`;
    }

    hasUserCoordinates() {
        return Number.isFinite(this.latValue) && Number.isFinite(this.lngValue);
    }

    currentUserPosition() {
        return {
            lat: Number(this.latValue),
            lng: Number(this.lngValue),
        };
    }

    renderNotificationsState() {
        if (!this.hasNotificationsPanelTarget) {
            return;
        }

        this.notificationsPanelTarget.classList.toggle('is-hidden', !this.notificationsOpen);
        if (this.hasNotificationsBadgeTarget) {
            this.notificationsBadgeTarget.textContent = '1';
            this.notificationsBadgeTarget.classList.toggle('is-hidden', this.notificationsOpen);
        }
    }

    renderLocationSwitcherState() {
        if (!this.hasLocationSwitcherTarget) {
            return;
        }

        this.locationSwitcherTarget.classList.toggle('is-hidden', !this.locationSwitcherOpen);

        if (this.locationSwitcherOpen) {
            const savedAddressesMarkup = this.savedAddresses.length > 0
                ? this.savedAddresses.map((address) => `
                    <button
                        type="button"
                        class="mobile-map-app__location-item"
                        data-action="click->map-shell#selectSavedAddress"
                        data-lat="${this.escapeHtml(String(address.latitude))}"
                        data-lng="${this.escapeHtml(String(address.longitude))}"
                        data-label="${this.escapeHtml(address.label)}"
                    >
                        <strong>${this.escapeHtml(address.label)}</strong>
                        <span>${this.escapeHtml(this.addressLine(address))}</span>
                    </button>
                `).join('')
                : '<p class="mobile-map-app__location-item">No tienes ubicaciones guardadas.</p>';

            // Aquí podrías añadir un enlace a un futuro flujo para agregar direcciones
            const addAddressMarkup = `
                <a href="#" class="mobile-map-app__location-item">
                    <strong>Agregar nueva ubicación</strong>
                </a>
            `;

            this.locationSwitcherTarget.innerHTML = savedAddressesMarkup + addAddressMarkup;
        }
    }

    persistLocationContext() {
        if (!this.hasUserCoordinates()) {
            return;
        }

        const payload = {
            lat: Number(this.latValue.toFixed(6)),
            lng: Number(this.lngValue.toFixed(6)),
            label: this.currentLocationLabel || 'Ubicación actual',
            updated_at: new Date().toISOString(),
        };

        try {
            window.localStorage.setItem('mi_monchis_location_context', JSON.stringify(payload));
        } catch (error) {
            // Ignore storage failures in demo mode.
        }

        if (window.history?.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.delete('lat');
            url.searchParams.delete('lng');
            window.history.replaceState({}, '', url.toString());
        }
    }

    restorePersistedLocationContext() {
        const hasServerCoordinates = this.hasUserCoordinates();
        let persistedContext = null;

        try {
            persistedContext = JSON.parse(window.localStorage.getItem('mi_monchis_location_context') ?? 'null');
        } catch (error) {
            persistedContext = null;
        }

        if (
            !hasServerCoordinates
            && persistedContext
            && Number.isFinite(Number(persistedContext.lat))
            && Number.isFinite(Number(persistedContext.lng))
        ) {
            this.latValue = Number(persistedContext.lat);
            this.lngValue = Number(persistedContext.lng);
        }

        if (persistedContext?.label) {
            this.currentLocationLabel = String(persistedContext.label);
            if (this.hasHeroLocationTarget) {
                this.heroLocationTarget.textContent = this.currentLocationLabel;
            }
            return;
        }

        if (hasServerCoordinates) {
            this.currentLocationLabel = 'Ubicación actual';
            if (this.hasHeroLocationTarget) {
                this.heroLocationTarget.textContent = this.currentLocationLabel;
            }
        }
    }

    async afterLayoutSettles() {
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    }

    refreshMapViewport() {
        if (!this.map || !window.google?.maps) {
            return;
        }

        const center = this.map.getCenter();
        window.google.maps.event.trigger(this.map, 'resize');

        if (center) {
            this.map.setCenter(center);
        }
    }

    locationKey(location) {
        if (location.selection_key) {
            return String(location.selection_key);
        }

        if (location.location_id != null && location.location_id !== '') {
            return `core:${location.location_id}`;
        }

        if (location.place_id) {
            return `place:${location.place_id}`;
        }

        return `unknown:${location.location_name ?? 'location'}`;
    }

    distanceMeters(lat1, lng1, lat2, lng2) {
        const earthRadius = 6371000;
        const dLat = this.degToRad(lat2 - lat1);
        const dLng = this.degToRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(this.degToRad(lat1)) * Math.cos(this.degToRad(lat2)) * Math.sin(dLng / 2) ** 2;

        return Math.round(earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
    }

    degToRad(value) {
        return value * (Math.PI / 180);
    }

    favoriteButtonMarkup(locationId) {
        const isFavorite = this.favoriteLocationIds.includes(locationId);

        return `
            <button
                type="button"
                class="mobile-map-card__heart ${isFavorite ? 'is-active' : ''}"
                data-action="map-shell#toggleFavorite"
                data-location-id="${locationId}"
                aria-label="Guardar favorito"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 21s-7-4.4-9.2-8.5C.9 9.1 2.3 5 6.3 5c2.2 0 3.6 1.3 4.4 2.4C11.5 6.3 12.9 5 15.1 5c4 0 5.4 4.1 3.5 7.5C16.4 16.6 12 21 12 21Z"></path>
                </svg>
            </button>
        `;
    }

    canFavorite(location) {
        return Number.isInteger(Number(location.location_id)) && location.source_type !== 'google_places';
    }

    addressLine(address) {
        const parts = [];

        if (address.city) {
            parts.push(address.city);
        }
        if (address.state) {
            parts.push(address.state);
        }
        if (address.reference) {
            parts.push(address.reference);
        }
        if (address.latitude && address.longitude) {
            parts.push(`${address.latitude}, ${address.longitude}`);
        }

        return parts.length > 0 ? parts.join(' · ') : 'Sin detalles adicionales.';
    }

    normalizeOptionalCoordinate(value) {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
    }

    resetAddressForm() {
        this.addressLabelInputTarget.value = '';
        this.addressCityInputTarget.value = '';
        this.addressStateInputTarget.value = '';
        this.addressReferenceInputTarget.value = '';
        this.addressPrimaryInputTarget.checked = false;
    }

    setAddressStatus(message) {
        if (this.hasAddressStatusTarget) {
            this.addressStatusTarget.textContent = message;
        }
    }

    setCanvasNote(message) {
        if (this.hasCanvasNoteTarget) {
            this.canvasNoteTarget.textContent = message;
        }
    }

    zoomIn() {
        if (!this.map) {
            return;
        }

        this.map.setZoom((this.map.getZoom() ?? 12) + 1);
    }

    zoomOut() {
        if (!this.map) {
            return;
        }

        this.map.setZoom((this.map.getZoom() ?? 12) - 1);
    }

    toggleMapType() {
        this.currentMapTypeId = this.currentMapTypeId === 'roadmap' ? 'satellite' : 'roadmap';

        if (this.map) {
            this.map.setMapTypeId(this.currentMapTypeId);
        }

        this.setStatus(this.currentMapTypeId === 'satellite' ? 'Mapa satelital activado.' : 'Mapa base activado.');
    }

    setSelectedLocation(locationKey) {
        this.selectedLocationId = locationKey;
        this.syncActiveCard();
    }

    syncActiveCard() {
        this.element.querySelectorAll('[data-card-location-key]').forEach((element) => {
            const locationKey = element.dataset.cardLocationKey ?? '';
            element.classList.toggle('is-active', locationKey !== '' && locationKey === this.selectedLocationId);
        });

        const escapedKey = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(String(this.selectedLocationId ?? ''))
            : String(this.selectedLocationId ?? '');
        const activeCard = this.element.querySelector(`[data-card-location-key="${escapedKey}"]`);
        if (activeCard) {
            activeCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    cardSubtitle(location) {
        if (location.source_type === 'google_places') {
            return location.short_address || 'Dirección pendiente';
        }

        if (location.merchant_name) {
            if (location.short_address && location.short_address !== location.merchant_name) {
                return `${location.merchant_name} • ${location.short_address}`;
            }

            return location.merchant_name;
        }

        if (location.short_address) {
            return location.short_address;
        }

        return 'Direccion pendiente';
    }

    formatDistance(distanceMeters) {
        if (distanceMeters == null) {
            return 'Cerca';
        }

        if (distanceMeters >= 1000) {
            return `${(distanceMeters / 1000).toFixed(1)} km`;
        }

        return `${distanceMeters} m`;
    }

    mediaTone(location) {
        const key = this.locationKey(location);
        let hash = 0;
        for (let index = 0; index < key.length; index += 1) {
            hash = (hash + key.charCodeAt(index)) % 4;
        }

        return hash + 1;
    }

    mediaStyle(location) {
        if (!location.photo_url) {
            return '';
        }

        return `style="background-image:url('${this.escapeHtml(location.photo_url)}')"`;
    }

    async enrichLocationIfNeeded(location) {
        if (location.source_type !== 'google_places' || !location.place_id) {
            return location;
        }

        const cachedDetails = this.placeDetailsCache.get(location.place_id);
        if (cachedDetails) {
            return this.applyLocationPatch(location, cachedDetails);
        }

        try {
            const details = await this.fetchGooglePlaceEnrichment(location.place_id);
            this.placeDetailsCache.set(location.place_id, details);
            return this.applyLocationPatch(location, details, { rerenderVisible: true });
        } catch (error) {
            return location;
        }
    }

    applyLocationPatch(location, patch, options = {}) {
        const locationKey = this.locationKey(location);
        const nextLocation = {
            ...location,
            ...patch,
        };

        if (Number.isFinite(nextLocation.lat) && Number.isFinite(nextLocation.lng) && this.hasUserCoordinates()) {
            nextLocation.distance_meters = this.distanceMeters(
                this.latValue,
                this.lngValue,
                Number(nextLocation.lat),
                Number(nextLocation.lng),
            );
        }

        this.currentLocations = this.currentLocations.map((candidate) => (
            this.locationKey(candidate) === locationKey
                ? { ...candidate, ...nextLocation }
                : candidate
        ));
        this.visibleLocations = this.filteredLocations(this.currentLocations);

        if (options.rerenderVisible) {
            this.renderCategoryChips(this.currentLocations);
            this.countTarget.textContent = String(this.visibleLocations.length);
            this.renderList(this.visibleLocations);
            this.syncFavoriteButtons();
            this.syncActiveCard();
        }

        return nextLocation;
    }

    reviewsLabel(location) {
        const rating = typeof location.rating === 'number' ? location.rating : null;
        const total = Number.isInteger(location.user_ratings_total) ? location.user_ratings_total : null;

        if (rating != null && total != null && total > 0) {
            return `${rating.toFixed(1)} (${total})`;
        }

        if (rating != null) {
            return `${rating.toFixed(1)} estrellas`;
        }

        return 'Sin reseñas';
    }

    locationIsOpen(location) {
        if (typeof location.open_now === 'boolean') {
            return location.open_now;
        }

        return null;
    }

    openingHoursSummary(location) {
        if (!Array.isArray(location.opening_hours_text) || location.opening_hours_text.length === 0) {
            return '';
        }

        return location.opening_hours_text[0] ?? '';
    }

    reviewSnippet(location) {
        if (!Array.isArray(location.google_reviews) || location.google_reviews.length === 0) {
            return '';
        }

        const firstReview = location.google_reviews.find((review) => review.text && review.text.trim() !== '');
        if (!firstReview) {
            return '';
        }

        const author = firstReview.author_name ? `${firstReview.author_name}: ` : '';
        const snippet = firstReview.text.trim();
        return `${author}${snippet.length > 110 ? `${snippet.slice(0, 107)}...` : snippet}`;
    }

    escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    normalizeComparisonText(value) {
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    async requestJson(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                ...(options.headers ?? {}),
            },
            ...options,
        });

        const payload = await response.json();
        if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
            throw new Error(payload.errors?.[0] ?? 'La operación no se pudo completar.');
        }

        return payload;
    }
}
