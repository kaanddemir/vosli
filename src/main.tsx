import '@fontsource/fira-sans/latin-400.css';
import '@fontsource/fira-sans/latin-ext-400.css';
import '@fontsource/fira-sans/latin-500.css';
import '@fontsource/fira-sans/latin-ext-500.css';
import '@fontsource/fira-sans/latin-600.css';
import '@fontsource/fira-sans/latin-ext-600.css';
import './styles/tokens.css';
import './styles/app.css';
import { render } from 'preact';
import { initArticleColors } from './articleColors';
import './pwa';
import { initTheme } from './theme';
import { App } from './ui/App';

initTheme();
initArticleColors();
render(<App />, document.getElementById('app')!);
