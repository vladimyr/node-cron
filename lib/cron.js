(function(root, factory) {
	if (typeof define === 'function' && define.amd) {
		define(['moment-timezone'], factory);
	} else if (typeof exports === 'object') {
		module.exports = factory(
			require('moment-timezone'),
			require('child_process')
		);
	} else {
		root.Cron = factory(root.moment);
	}
})(this, function(moment, childProcess) {
	const exports = {};
	const timeUnits = [
		'second',
		'minute',
		'hour',
		'dayOfMonth',
		'month',
		'dayOfWeek'
	];
	const { spawn } = childProcess;

	class CronTime {
		constructor(source, zone, utcOffset) {
			this.source = source;

			if (zone) {
				if (!moment.tz.names().includes(zone)) {
					throw new Error('Invalid timezone.');
				}
				this.zone = zone;
			}

			if (utcOffset !== undefined) {
				this.utcOffset = utcOffset;
			}

			timeUnits.reduce((acc, timeUnit) => {
				return Object.assign(acc, { [timeUnit]: {} });
			}, this);

			if (this.source instanceof Date || moment.isMoment(this.source)) {
				this.source = moment(this.source);
				this.realDate = true;
			} else {
				this._parse();
				this._verifyParse();
			}
		}

		_verifyParse() {
			const values = obj => Object.keys(obj).map(key => parseInt(key, 10));

			// if a dayOfMonth is not found in all months, we only need to fix the last
			// wrong month  to prevent infinite loop
			let lastWrongMonth;
			values(this.month).forEach(month => {
				const maxDays = CronTime.monthConstraints[month];
				if (values(this.dayOfMonth).every(day => day > maxDays)) {
					// save the month in order to be fixed if all months fails (infinite loop)
					lastWrongMonth = month;
					console.warn(`Month "${month}" is limited to "${maxDays}" days.`);
				}
			});

			if (!lastWrongMonth) return;

			// infinite loop detected (dayOfMonth is not found in all months)
			const maxDays = CronTime.monthConstraints[lastWrongMonth];
			this.dayOfMonth = values(this.dayOfMonth).reduce((acc, day) => {
				if (day <= maxDays) return acc;
				delete acc[day];
				acc[day % maxDays] = true;
				return acc;
			}, this.dayOfMonth);
		}

		/**
		 * calculates the next send time
		 */
		sendAt(n) {
			const date = this.realDate ? moment(this.source) : moment();
			// Set the timezone if given (https://momentjs.com/timezone/docs/#/using-timezones/parsing-in-zone/)
			if (this.zone) {
				date.tz(this.zone);
			}

			if (this.utcOffset !== undefined) {
				date.utcOffset(this.utcOffset);
			}

			if (this.realDate) {
				const diff = moment().diff(date, 'seconds');
				if (diff > 0) {
					throw new Error('WARNING: Date in past. Will never be fired.');
				}
				return date;
			}

			// If the n argument is not given, return the next send time
			if (!Number.isInteger(n) || n <= 0) return this._getNextDateFrom(date);
			// Else return the next n send times
			return Array.from({ length: n }).map(() => this._getNextDateFrom());
		}

		/**
		 * Get the number of milliseconds in the future at which to fire our callbacks.
		 */
		getTimeout() {
			return Math.max(-1, this.sendAt().diff());
		}

		/**
		 * writes out a cron string
		 */
		toString() {
			return this.toJSON().join(' ');
		}

		/**
		 * Json representation of the parsed cron syntax.
		 */
		toJSON() {
			return timeUnits.map(timeUnit => this._wcOrAll(timeUnit));
		}

		/**
		 * get next date that matches parsed cron time
		 */
		_getNextDateFrom(start, zone) {
			let date = moment(start);
			if (zone) date.tz(zone);

			if (!date.isValid()) {
				throw new Error('ERROR: You specified an invalid date.');
			}

			if (!this.realDate && date.milliseconds() > 0) {
				date.milliseconds(0);
				date.add(1, 'seconds');
			}

			const has = (type, value) => type[value];
			const size = type => Object.keys(type).length;

			// It shouldn't take more than 5 seconds to find the next execution time
			// being very generous with this. Throw error if it takes too long to find
			// the next time to protect from infinite loop.
			const timeout = Date.now() + 5000;

			// determine next date
			while (true) {
				const now = moment();
				if (now > timeout) {
					const data = [
						`Time Zone: ${zone || '""'}`,
						`Cron String: ${this.toString()}`,
						`UTC offset: ${date.format('Z')}`,
						`current Date: ${now.toString()}`
					];
					throw new Error(
						`Something went wrong. cron reached maximum iterations.
						Please open an issue (https://github.com/kelektiv/node-cron/issues/new) and provide the following string:
						${data.join(' - ')}`
					);
				}

				if (!has(this.month, date.month()) && size(this.month) !== 12) {
					const prevMonth = date.month();
					date.add(1, 'month');
					if (prevMonth === date) date.add(1, 'month');
					date.date(1);
					date.hours(0);
					date.minutes(0);
					date.seconds(0);
					continue;
				}

				if (
					!has(this.dayOfMonth, date.date()) &&
					size(this.dayOfMonth) !== 31 &&
					!(has(this.dayOfWeek, date.day()) && size(this.dayOfWeek) !== 7)
				) {
					const prevDay = date.day();
					date.add(1, 'day');
					if (prevDay === date.day()) date.add(1, 'day');
					date.hours(0);
					date.minutes(0);
					date.seconds(0);
					continue;
				}

				const origDate = moment(date);

				if (
					!has(this.dayOfWeek, date.day()) &&
					size(this.dayOfWeek) !== 7 &&
					!(has(this.dayOfMonth, date.date()) && size(this.dayOfMonth) !== 31)
				) {
					const prevDay = date.day();
					date.add(1, 'day');
					if (prevDay === date.day()) date.add(1, 'day');
					date.hours(0);
					date.minutes(0);
					date.seconds(0);
					if (date <= origDate) date = this._findDST(origDate);
					continue;
				}

				if (!has(this.hour, date.hour()) && size(this.hour) !== 24) {
					const prevHour = date.hour();
					const isOverflow =
						prevHour === 23 && date.diff(start) > moment.duration(1, 'day');
					isOverflow ? date.hour(0) : date.add(1, 'hour');
					// Moment Date will not allow you to set the time to 2 AM if there is
					// no 2 AM (on the day we change the clock). We will therefore jump to
					// 3AM if time stayed at 1AM.
					if (prevHour === date.hour()) date.add(2, 'hours');
					date.minutes(0);
					date.seconds(0);
					if (date <= origDate) date = this._findDST(origDate);
					continue;
				}

				if (!has(this.minute, date.minute()) && size(this.minute) !== 60) {
					const isOverflow =
						date.minute() === 59 &&
						date.diff(start) > moment.duration(1, 'hour');
					isOverflow ? date.minute(0) : date.add(1, 'minute');
					date.seconds(0);
					if (date <= origDate) date = this._findDST(origDate);
					continue;
				}

				if (!has(this.second, date.second()) && size(this.second) !== 60) {
					const isOverflow =
						date.second() === 59 &&
						date.diff(start) > moment.duration(1, 'minute');
					isOverflow ? date.second(0) : date.add(1, 'second');
					if (date <= origDate) date = this._findDST(origDate);
					continue;
				}

				if (date.isSame(start)) {
					date.add(1, 'second');
					continue;
				}

				break;
			}

			return date;
		}

		/**
		 * get next date that is a valid DST date
		 */
		_findDST(date) {
			const newDate = moment(date);
			// eslint-disable-next-line no-unmodified-loop-condition
			while (newDate <= date) newDate.add(1, 'second');
			return newDate;
		}

		/**
		 * wildcard, or all params in array (for to string)
		 */
		_wcOrAll(type) {
			if (this._hasAll(type)) return '*';
			return Object.keys(type)
				.reduce((acc, key) => {
					const value = type[key];
					if (value) acc.push(value);
					return acc;
				}, [])
				.join(',');
		}

		_hasAll(type) {
			const index = timeUnits.indexOf(type);
			const [low, high] = CronTime.constraints[index];
			let i = low;
			while (i < high) {
				if (!this[type][i]) return false;
				i += 1;
			}
			return true;
		}

		_parse() {
			const { aliases } = CronTime;
			const source = this.source.trim().replace(/[a-z]{1,3}/gi, alias => {
				alias = alias.toLowerCase();
				if (alias in aliases) return aliases[alias];
				throw new Error(`Unknown alias: ${alias}`);
			});

			const tokens = source.split(/\s+/);
			if (tokens.length < timeUnits.length - 1) {
				throw new Error('Too few fields');
			}
			if (tokens.length > timeUnits.length) {
				throw new Error('Too many fields');
			}

			// If the split source string doesn't contain all digits,
			// assume defaults for first n missing digits.
			// This adds support for 5-digit standard cron syntax
			const diff = timeUnits.length - tokens.length;
			if (diff > 0) {
				tokens.unshift(...Array.from({ length: diff }));
			}

			timeUnits.forEach((timeUnit, i) => {
				const token = tokens[i] || CronTime.parseDefaults[i];
				this._parseField(token, timeUnit, CronTime.constraints[i]);
			});
		}

		// TODO: Refactor this!
		_parseField(field, type, constraints) {
			var rangePattern = /^(\d+)(?:-(\d+))?(?:\/(\d+))?$/g;
			var typeObj = this[type];
			var pointer;
			var low = constraints[0];
			var high = constraints[1];

			var fields = field.split(',');
			fields.forEach(function(field) {
				var wildcardIndex = field.indexOf('*');
				if (wildcardIndex !== -1 && wildcardIndex !== 0) {
					throw new Error('Field (' + field + ') has an invalid wildcard expression');
				}
			});

			// * is a shortcut to [lower-upper] range
			field = field.replace(/\*/g, low + '-' + high);

			// commas separate information, so split based on those
			var allRanges = field.split(',');

			for (var i = 0; i < allRanges.length; i++) {
				if (allRanges[i].match(rangePattern)) {
					allRanges[i].replace(rangePattern, function($0, lower, upper, step) {
						lower = parseInt(lower, 10);
						upper = parseInt(upper, 10) || undefined;

						const wasStepDefined = !isNaN(parseInt(step, 10));
						if (step === '0') {
							throw new Error('Field (' + field + ') has a step of zero');
						}
						step = parseInt(step, 10) || 1;

						if (upper && lower > upper) {
							throw new Error('Field (' + field + ') has an invalid range');
						}

						const outOfRangeError =
							lower < low ||
							(upper && upper > high) ||
							(!upper && lower > high);

						if (outOfRangeError) {
							throw new Error('Field (' + field + ') value is out of range');
						}

						// Positive integer higher than constraints[0]
						lower = Math.min(Math.max(low, ~~Math.abs(lower)), high);

						// Positive integer lower than constraints[1]
						if (upper) {
							upper = Math.min(high, ~~Math.abs(upper));
						} else {
							// If step is provided, the default upper range is the highest value
							upper = wasStepDefined ? high : lower;
						}

						// Count from the lower barrier to the upper
						pointer = lower;

						do {
							typeObj[pointer] = true;
							pointer += step;
						} while (pointer <= upper);
					});
				} else {
					throw new Error('Field (' + field + ') cannot be parsed');
				}
			}
		}
	}

	CronTime.constraints = [
		[0, 59],
		[0, 59],
		[0, 23],
		[1, 31],
		[0, 11],
		[0, 6]
	];
	CronTime.monthConstraints = [
		31,
		29, // support leap year...not perfect
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31
	];
	CronTime.parseDefaults = ['0', '*', '*', '*', '*', '*'];
	CronTime.aliases = {
		jan: 0,
		feb: 1,
		mar: 2,
		apr: 3,
		may: 4,
		jun: 5,
		jul: 6,
		aug: 7,
		sep: 8,
		oct: 9,
		nov: 10,
		dec: 11,
		sun: 0,
		mon: 1,
		tue: 2,
		wed: 3,
		thu: 4,
		fri: 5,
		sat: 6
	};

	const MAXDELAY = 2147483647; // The maximum number of milliseconds setTimeout will wait.

	const isObject = arg => arg !== null && typeof arg === 'object';
	const isFunction = arg => typeof arg === 'function';
	const isString = arg => typeof arg === 'string';

	function command2function(cmd) {
		if (isFunction(cmd)) return cmd;

		if (isString(cmd)) {
			const args = cmd.split(/\s+/);
			const command = args.shift();
			return spawn.bind(undefined, command, args);
		}

		const command = cmd && cmd.command;
		if (!command) return;

		const { args, options } = cmd;
		return spawn.bind(undefined, command, args, options);
	}

	class CronJob {
		constructor(
			cronTime,
			onTick,
			onComplete,
			startNow,
			timeZone,
			context,
			runOnInit,
			utcOffset,
			unrefTimeout
		) {
			let _cronTime = cronTime;

			if (arguments.length === 1 && isObject(cronTime)) {
				onTick = cronTime.onTick;
				onComplete = cronTime.onComplete;
				context = cronTime.context;
				startNow = cronTime.start || cronTime.startNow || cronTime.startJob;
				timeZone = cronTime.timeZone;
				runOnInit = cronTime.runOnInit;
				_cronTime = cronTime.cronTime;
				utcOffset = cronTime.utcOffset;
				unrefTimeout = cronTime.unrefTimeout;
			}

			this.context = context || this;
			this._callbacks = [];
			this.onComplete = command2function(onComplete);
			this.cronTime = new CronTime(_cronTime, timeZone, utcOffset);
			this.runOnce = Boolean(this.cronTime.realDate);
			this.unrefTimeout = unrefTimeout;

			this.addCallback(command2function(onTick));

			if (runOnInit) {
				this.lastExecution = new Date();
				this.fireOnTick();
			}
			if (startNow) this.start();
		}

		addCallback(callback) {
			if (isFunction(callback)) this._callbacks.push(callback);
		}

		setTime(time) {
			if (!(time instanceof CronTime)) {
				throw new Error('time must be an instance of CronTime.');
			}
			this.stop();
			this.cronTime = time;
			this.start();
		}

		nextDates(i) {
			return this.cronTime.sendAt(i);
		}

		nextDate() {
			this.nextDates();
		}

		fireOnTick() {
			this._callbacks.forEach(callback => {
				callback.call(this.context, this.onComplete);
			});
		}

		start() {
			if (this.running) return;

			let remaining = this.cronTime.getTimeout();
			if (remaining < 0) {
				this.stop();
				return;
			}

			// Don't try to sleep more than MAXDELAY ms at a time.
			const delay = Math.min(remaining, MAXDELAY);
			remaining = Math.max(remaining - MAXDELAY, 0);

			this._timeout = _setTimeout(callbackWrapper, delay, {
				context: this,
				unrefTimeout: this.unrefTimeout
			});
			this.running = true;

			// The callback wrapper checks if it needs to sleep another period or not
			// and does the real callback logic when it's time.
			function callbackWrapper(startTime, delay) {
				const delta = startTime + delay - Date.now();
				if (delta > 0) {
					remaining += Math.min(delta, this.cronTime.getTimeout());
				}

				if (remaining <= 0) {
					// We have arrived at the correct point in time.
					this.running = false;
					// start before calling back so the callbacks have the ability to stop the cron job
					if (!this.runOnce) this.start();
					this.lastExecution = new Date();
					this.fireOnTick();
					return;
				}

				// If there is sleep time remaining, calculate how long and go to sleep
				// again. This processing might make us miss the deadline by a few ms
				// times the number of sleep sessions. Given a MAXDELAY of almost a
				// month, this should be no issue.
				const newDelay = Math.min(remaining, MAXDELAY);
				remaining = Math.max(remaining - MAXDELAY, 0);

				this._timeout = _setTimeout(callbackWrapper, newDelay, {
					context: this,
					unrefTimeout: this.unrefTimeout
				});
			}

			function _setTimeout(callback, delay, options = {}) {
				const { context, unrefTimeout = false } = options;
				const startTime = Date.now();
				const timeout = setTimeout(() => {
					callback.call(context, startTime, delay);
				}, delay);
				if (unrefTimeout && isFunction(timeout.unref)) timeout.unref();
				return timeout;
			}
		}

		lastDate() {
			return this.lastExecution;
		}

		stop() {
			if (this._timeout) clearTimeout(this._timeout);
			this.running = false;
			if (isFunction(this.onComplete)) this.onComplete();
		}
	}

	exports.job = (
		cronTime,
		onTick,
		onComplete,
		startNow,
		timeZone,
		context,
		runOnInit,
		utcOffset,
		unrefTimeout
	) => {
		return new CronJob(
			cronTime,
			onTick,
			onComplete,
			startNow,
			timeZone,
			context,
			runOnInit,
			utcOffset,
			unrefTimeout
		);
	};

	exports.time = (cronTime, timeZone) => new CronTime(cronTime, timeZone);
	exports.sendAt = cronTime => exports.time(cronTime).sendAt();
	exports.timeout = cronTime => exports.time(cronTime).getTimeout();

	exports.CronJob = CronJob;
	exports.CronTime = CronTime;

	return exports;
});
