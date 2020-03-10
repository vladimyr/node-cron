'use strict';

const { CronJob } = require('..');

console.log('Before job instantiation');
const date = new Date();
date.setSeconds(date.getSeconds() + 2);
const job = new CronJob(date, () => {
	const d = new Date();
	console.log('Specific date:', date, ', onTick at:', d);
});
console.log('After job instantiation');
job.start();
