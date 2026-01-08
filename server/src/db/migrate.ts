import { runMigrations, closeDatabase } from './index.js';

console.log('Running database migrations...');
runMigrations();
closeDatabase();
console.log('Done!');
