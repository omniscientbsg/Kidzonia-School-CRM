import { installErrorReporting } from './error-reporting';

// Imported once from main.tsx, before anything renders, so early errors are caught too.
installErrorReporting(import.meta.env);
