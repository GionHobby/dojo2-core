import Promise, { Executor, State, Thenable, isThenable } from '../Promise';

export let Canceled = <State> 4;

export default class Task<T> extends Promise<T> {
	protected static copy<U>(other: Promise<U>): Task<U> {
		let task = <Task<U>> super.copy(other);
		task.children = [];
		task.canceler = other instanceof Task ? other.canceler : () => {};
		return task;
	}

	constructor(executor: Executor<T>, canceler: () => void) {
		super(<Executor<T>> ((resolve, reject) => {
			// Don't let the Task resolve if it's been canceled
			executor(
				value => {
					if (this._state !== Canceled) {
						resolve(value);
					}
				},
				reason => {
					if (this._state !== Canceled) {
						reject(reason);
					}
				}
			);
		}));

		this.children = [];
		this.canceler = () => {
			canceler();
			this._cancel();
		}
	}

	/**
	 * A cancelation handler that will be called if this task is canceled.
	 */
	private canceler: () => void;
	
	/**
	 * Children of this Task (i.e., Tasks that were created from this Task with `then` or `catch`).
	 */
	private children: Task<any>[];

	/**
	 * The finally callback for this Task if it was created by a call to `finally`
	 */
	private _finally: () => void | Thenable<any>;

	/**
	 * Propogates cancelation down through a Task tree. The Task's state is immediately set to canceled. If a Thenable
	 * finally task was passed in, it is resolved before calling this Task's finally callback; otherwise, this Task's
	 * finally callback is immediately executed. `_cancel` is called for each child Task, passing in the value returned
	 * by this Task's finally callback or a Promise chain that will eventually resolve to that value.
	 */
	private _cancel(finallyTask?: void | Thenable<any>): void {
		this._state = Canceled;

		let runFinally = () => {
			try {
				return this._finally();
			}
			catch (error) {
				// Any errors in a `finally` callback are completely ignored during cancelation
			}
		}

		if (this._finally) {
			if (isThenable(finallyTask)) {
				finallyTask = (<Thenable<any>> finallyTask).then(runFinally, runFinally);
			}
			else {
				finallyTask = runFinally();
			}
		}

		this.children.forEach(child => child._cancel(finallyTask));
	}

	/**
	 * Immediately cancel this task. This Task and any descendants are synchronously set to the Canceled state and any
	 * `finally` added downstream from the canceled Task are invoked.
	 */
	cancel(): void {
		if (this._state === State.Pending) {
			this.canceler();
		}
	}

	finally(callback: () => void | Thenable<any>): Task<T> {
		let task = <Task<T>> super.finally(callback);
		// Keep a reference to the callback; it will be called if the Task is canceled
		task._finally = callback;
		return task;
	}

	then<U>(onFulfilled?: (value: T) => U | Thenable<U>,  onRejected?: (error: Error) => U | Thenable<U>): Task<U> {
		let task = <Task<U>> Task.copy(super.then<U>(
			// Don't call the onFulfilled or onRejected handlers if this Task is canceled
			value => {
				if (task._state !== Canceled) {
					return onFulfilled(value);
				}
			},
			error => {
				if (task._state !== Canceled) {
					return onRejected(error);
				}
			}
		));

		task.canceler = () => {
			// If task's parent (this) hasn't been resolved, cancel it; downward propagation will start at the first
			// unresolved parent
			if (this._state === State.Pending) {
				this.cancel();
			}
			// If task's parent has been resolved, propagate cancelation to the task's descendants
			else {
				task._cancel();
			}
		};

		// Keep track of child Tasks for propogating cancelation back down the chain
		this.children.push(task);

		return task;
	}
}
