'use strict';

const { CronJob } = require('..');

console.log('Before job instantiation');
const job = new CronJob('0 */30 9-17 * * *', () => {
	const d = new Date();
	console.log('Every 30 minutes between 9-17:', d);
});
console.log('After job instantiation');
job.start();
