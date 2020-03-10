'use strict';

const { CronJob } = require('..');

console.log('first');
const job = new CronJob(
	'0 0 9 4 * *',
	() => console.log('message'),
	null,
	true,
	'America/Sao_Paulo'
);
console.log('second');
job.start();
