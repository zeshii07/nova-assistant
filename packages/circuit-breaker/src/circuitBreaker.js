// v35.3: Simple circuit breaker for external service calls.
// Prevents cascading failures when an external dependency (Google Calendar,
// Gmail SMTP, Groq LLM, Gemini LLM) goes down.

class CircuitBreaker {
  constructor(opts = {}) {
    this.name = opts.name || 'unknown';
    this.failureThreshold = opts.failureThreshold || 5;
    this.successThreshold = opts.successThreshold || 2;
    this.resetTimeout = opts.resetTimeout || 30_000;
    this.timeout = opts.timeout || 10_000;
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.logger = opts.logger || null;
  }

  async run(fn) {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeout) {
        this._setState('HALF_OPEN');
        this.successes = 0;
      } else {
        const err = new Error(`Circuit "${this.name}" is OPEN — service unavailable`);
        err.code = 'CIRCUIT_OPEN';
        err.retryAfterMs = this.resetTimeout - elapsed;
        throw err;
      }
    }

    let result;
    try {
      result = await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => {
          const err = new Error(`Circuit "${this.name}" call timed out after ${this.timeout}ms`);
          err.code = 'CIRCUIT_TIMEOUT';
          reject(err);
        }, this.timeout))
      ]);
    } catch (err) {
      this._onFailure(err);
      throw err;
    }

    this._onSuccess();
    return result;
  }

  _onSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this._setState('CLOSED');
      }
    }
  }

  _onFailure(err) {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.state === 'HALF_OPEN') {
      this._setState('OPEN');
    } else if (this.failures >= this.failureThreshold) {
      this._setState('OPEN');
    }
    this.logger?.warn?.('circuit_breaker.failure', {
      name: this.name, state: this.state, failures: this.failures, error: err.message
    });
  }

  _setState(newState) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.logger?.info?.('circuit_breaker.state_change', {
      name: this.name, from: oldState, to: newState
    });
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
  }
}

module.exports = { CircuitBreaker };
