import { startStimulusApp } from '@symfony/stimulus-bundle';
import MapShellController from './controllers/map_shell_controller.js';

const app = startStimulusApp();
app.register('map-shell', MapShellController);
