import { Controller } from '@hotwired/stimulus';

export default class extends Controller {
    static targets = [
        'canvas',
        'status',
        'count',
        'list',
        'heroLocation',
        'categoryChip',
        'notificationsButton',
        'notificationsPanel',
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
        this.selectedLocationId = null;
        this.activeCategoryFilter = 'all';
        this.map = null;
        this.markers = [];
        this.infoWindow = null;
        this.googleMapsReady = false;
        this.currentMapTypeId = 'roadmap';
        this.walkthroughTypingTimer = null;
        this.walkthroughHideTimer = null;
        this.walkthroughPredictions = [];
        this.walkthroughSelection = null;
        this.userMarker = null;
        this.notificationsOpen = false;
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

        if (this.googleMapsReady && this.map) {
            this.focusMapLocation(location);
            return;
        }

        this.setStatus(`Local seleccionado: ${location.location_name ?? locationKey}.`);
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

            if (canonicalLocations.length === 0 && this.hasUserCoordinates() && this.googleMapsApiKeyValue && this.googleMapsApiKeyValue.trim() !== '') {
                const fallbackLocations = await this.fetchNearbyPlacesFallback();
                if (fallbackLocations.length > 0) {
                    locations = fallbackLocations;
                    this.currentFeedSource = 'places_fallback';
                }
            }

            this.currentLocations = locations;
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
                    ? 'Mostrando lugares cercanos descubiertos desde Google Places.'
                    : 'No encontré lugares cercanos desde Google Places.');
                return;
            }

            this.setStatus(locations.length > 0 ? 'Feed cargado correctamente.' : 'Feed cargado sin resultados.');
        } catch (error) {
            this.setStatus(`No se pudo cargar el feed: ${error.message}`);
            if (this.hasListTarget) {
                this.listTarget.innerHTML = '<div class="map-shell__empty">No se pudo cargar el feed.</div>';
            }
            this.canvasTarget.innerHTML = '';
        }
    }

    applyCategoryFilter(event) {
        const nextFilter = event.currentTarget.dataset.categoryFilter ?? 'all';
        this.activeCategoryFilter = nextFilter;

        if (this.hasCategoryChipTarget) {
            this.categoryChipTargets.forEach((chip) => {
                chip.classList.toggle('is-active', chip.dataset.categoryFilter === nextFilter);
            });
        }

        this.visibleLocations = this.filteredLocations(this.currentLocations);
        const selectedStillVisible = this.visibleLocations.find((location) => this.locationKey(location) === this.selectedLocationId);
        if (!selectedStillVisible) {
            this.selectedLocationId = this.visibleLocations[0] ? this.locationKey(this.visibleLocations[0]) : null;
        }

        this.countTarget.textContent = String(this.visibleLocations.length);
        this.renderList(this.visibleLocations);
        this.renderCanvas(this.visibleLocations);
        this.syncFavoriteButtons();
        this.syncActiveCard();
        this.setStatus(this.visibleLocations.length > 0
            ? `Filtro aplicado: ${event.currentTarget.textContent?.trim() ?? nextFilter}.`
            : 'No encontré locales para ese filtro.');
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
                <div class="mobile-map-card__media mobile-map-card__media--${this.mediaTone(location)}">
                    ${this.canFavorite(location) ? this.favoriteButtonMarkup(Number(location.location_id)) : ''}
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
                        <span class="mobile-map-card__status">${this.escapeHtml(this.publicationStatusLabel(location.publication_state))}</span>
                        <span class="mobile-map-card__reviews">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m12 3.8 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17.1 6.8 19.8l1-5.8-4.2-4.1 5.8-.8L12 3.8Z"></path>
                            </svg>
                            Sin reviews
                        </span>
                    </div>
                </div>
            </article>
        `).join('');
    }

    async renderCanvas(locations) {
        if (this.googleMapsApiKeyValue && this.googleMapsApiKeyValue.trim() !== '') {
            try {
                await this.renderGoogleMap(locations);
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

    async renderGoogleMap(locations) {
        const google = await this.loadGoogleMaps();
        await this.afterLayoutSettles();

        this.canvasTarget.innerHTML = '';

        if (!this.map) {
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
        }

        this.map.setMapTypeId(this.currentMapTypeId);

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
                this.setCanvasNote(locations.length === 0
                    ? 'Ya ubicamos tu zona, pero todavía no hay locales visibles publicados.'
                    : 'Ubicamos tu zona, pero los locales visibles aún no traen coordenadas publicadas.');
                return;
            }

            this.map.setCenter({ lat: 19.432608, lng: -99.133209 });
            this.map.setZoom(11);
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

            marker.addListener('click', () => {
                this.setSelectedLocation(this.locationKey(location));
                this.openInfoWindow(location, marker);
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

        if (hasUserCoordinates && validLocations.length > 0) {
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
        this.setCanvasNote(this.currentFeedSource === 'places_fallback'
            ? `${validLocations.length} lugares cercanos cargados desde Google Places.`
            : `${validLocations.length} marcadores cargados en Google Maps.`);
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

        this.map.panTo(marker.getPosition());
        this.map.setZoom(16);
        this.openInfoWindow(location, marker);
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
        if (!google.maps.places?.PlacesService) {
            throw new Error('La librería de Places no está disponible. Activa Places API para usar sugerencias de dirección.');
        }

        const serviceNode = this.placeDetailsNode ?? document.createElement('div');
        this.placeDetailsNode = serviceNode;
        const service = this.placeDetailsService ?? new google.maps.places.PlacesService(serviceNode);
        this.placeDetailsService = service;

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

    async fetchNearbyPlacesFallback() {
        const google = await this.loadGoogleMaps();
        if (!google.maps.places?.PlacesService || !this.hasUserCoordinates()) {
            return [];
        }

        const serviceNode = this.nearbyPlacesNode ?? document.createElement('div');
        this.nearbyPlacesNode = serviceNode;
        const service = this.nearbyPlacesService ?? new google.maps.places.PlacesService(serviceNode);
        this.nearbyPlacesService = service;
        const userPosition = this.currentUserPosition();

        return new Promise((resolve, reject) => {
            service.nearbySearch({
                location: userPosition,
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
        this.persistCoordinates();
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
                <span class="welcome-flow__suggestion-secondary">${this.escapeHtml(prediction.secondaryText || prediction.description)}</span>
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
        const statusLabel = this.escapeHtml(this.publicationStatusLabel(location.publication_state));
        const distanceLabel = location.distance_meters != null ? this.escapeHtml(this.formatDistance(location.distance_meters)) : 'Zona cercana';
        const sourceLabel = this.escapeHtml(this.sourceTypeLabel(location.source_type));
        const directionsUrl = this.buildDirectionsUrl(location);
        const whatsappUrl = this.buildWhatsAppUrl(location.whatsapp_enabled, location.whatsapp_e164);

        return `
            <article class="map-shell__info-window">
                <header class="map-shell__info-window-header">
                    <div>
                        <strong>${locationName}</strong>
                        <p class="map-shell__info-window-merchant">${merchantName}</p>
                    </div>
                    <span class="map-shell__info-window-badge">${statusLabel}</span>
                </header>
                <p class="map-shell__info-window-address">${address}</p>
                <div class="map-shell__info-window-meta">
                    <span>${distanceLabel}</span>
                    <span>${sourceLabel}</span>
                </div>
                <div class="map-shell__info-window-actions">
                    ${directionsUrl ? `<a href="${this.escapeHtml(directionsUrl)}" target="_blank" rel="noreferrer">Cómo llegar</a>` : ''}
                    ${whatsappUrl ? `<a href="${this.escapeHtml(whatsappUrl)}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''}
                </div>
            </article>
        `;
    }

    publicationStatusLabel(publicationState) {
        if (publicationState === 'public_visible') {
            return 'Visible ahora';
        }

        if (publicationState === 'fallback_visible') {
            return 'Descubierto';
        }

        return 'Pendiente';
    }

    sourceTypeLabel(sourceType) {
        if (sourceType === 'owner_registered') {
            return 'Registrado por dueño';
        }

        if (sourceType === 'google_places') {
            return 'Descubierto en Google';
        }

        return 'Origen pendiente';
    }

    locationCategory(location) {
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

    persistCoordinates() {
        if (!this.hasUserCoordinates() || !window.history?.replaceState) {
            return;
        }

        const url = new URL(window.location.href);
        url.searchParams.set('lat', this.latValue.toFixed(6));
        url.searchParams.set('lng', this.lngValue.toFixed(6));
        window.history.replaceState({}, '', url.toString());
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
        const pieces = [];

        if (location.short_address) {
            pieces.push(location.short_address);
        }
        if (location.merchant_name) {
            pieces.push(location.merchant_name);
        }

        return pieces.length > 0 ? pieces.join(' • ') : 'Direccion pendiente';
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

    escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
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
