// ══════════════════════════════════════════════════════════════
// error-tracker.js — Captura, clasifica y analiza errores del sistema
// ══════════════════════════════════════════════════════════════

class ErrorTracker {
  constructor() {
    this.errors = [];
    this.operations = [];
    this.startTime = Date.now();
    this.endpointStats = {};
    this.errorsByType = { http: {}, validation: {}, schema: {}, permission: {}, timeout: 0, unknown: 0 };
    this.successCount = 0;
    this.errorCount = 0;
  }

  recordOperation(endpoint, method, statusCode, responseTime, response = null, requestData = null) {
    const op = {
      id: this.operations.length + 1,
      endpoint,
      method,
      statusCode,
      responseTime,
      timestamp: new Date().toISOString(),
      success: statusCode >= 200 && statusCode < 300,
      requestData,
      response: response ? (typeof response === 'string' ? response : JSON.stringify(response).slice(0, 500)) : null
    };

    this.operations.push(op);

    // Track endpoint stats
    const key = `${method} ${endpoint}`;
    if (!this.endpointStats[key]) {
      this.endpointStats[key] = { calls: 0, successes: 0, errors: 0, totalTime: 0, errorsByCode: {} };
    }
    this.endpointStats[key].calls++;
    this.endpointStats[key].totalTime += responseTime;

    if (op.success) {
      this.successCount++;
      this.endpointStats[key].successes++;
    } else {
      this.errorCount++;
      this.endpointStats[key].errors++;
      const codeStr = String(statusCode);
      this.endpointStats[key].errorsByCode[codeStr] = (this.endpointStats[key].errorsByCode[codeStr] || 0) + 1;

      const error = {
        id: this.errors.length + 1,
        endpoint,
        method,
        statusCode,
        responseTime,
        timestamp: new Date().toISOString(),
        errorType: this._classifyError(statusCode, response),
        message: this._extractMessage(response),
        requestData,
        response
      };
      this.errors.push(error);
      this._categorizeError(error);
    }

    return op;
  }

  recordRawError(category, message, details = null) {
    const error = {
      id: this.errors.length + 1,
      endpoint: 'INTERNAL',
      method: 'INTERNAL',
      statusCode: 0,
      responseTime: 0,
      timestamp: new Date().toISOString(),
      errorType: category,
      message,
      details
    };
    this.errors.push(error);
    this.errorCount++;
    if (this.errorsByType[category] && typeof this.errorsByType[category] === 'object') {
      this.errorsByType[category]['internal'] = (this.errorsByType[category]['internal'] || 0) + 1;
    }
    return error;
  }

  _classifyError(statusCode, response) {
    if (statusCode >= 500) return 'server_error';
    if (statusCode === 401) return 'authentication';
    if (statusCode === 403) return 'authorization';
    if (statusCode === 404) return 'not_found';
    if (statusCode === 400) return 'validation';
    if (statusCode === 409) return 'conflict';
    if (statusCode === 0) return 'timeout';
    return 'unknown';
  }

  _extractMessage(response) {
    if (!response) return 'No response';
    try {
      const data = typeof response === 'string' ? JSON.parse(response) : response;
      return data.error || data.message || data.msg || JSON.stringify(data).slice(0, 200);
    } catch (_) {
      return String(response).slice(0, 200);
    }
  }

  _categorizeError(error) {
    const sc = error.statusCode;
    if (sc >= 500) {
      this.errorsByType.http['5xx'] = (this.errorsByType.http['5xx'] || 0) + 1;
    } else if (sc >= 400) {
      this.errorsByType.http['4xx'] = (this.errorsByType.http['4xx'] || 0) + 1;
    }

    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('required') || msg.includes('invalid') || msg.includes('missing')) {
      this.errorsByType.validation[error.endpoint] = (this.errorsByType.validation[error.endpoint] || 0) + 1;
    }
    if (msg.includes('not found') || msg.includes('could not find') || msg.includes('table')) {
      this.errorsByType.schema[error.endpoint] = (this.errorsByType.schema[error.endpoint] || 0) + 1;
    }
    if (msg.includes('permission') || msg.includes('access') || msg.includes('role') || msg.includes('forbidden')) {
      this.errorsByType.permission[error.endpoint] = (this.errorsByType.permission[error.endpoint] || 0) + 1;
    }
  }

  getSummary() {
    const elapsed = Date.now() - this.startTime;
    return {
      totalOperations: this.operations.length,
      successCount: this.successCount,
      errorCount: this.errorCount,
      successRate: this.operations.length > 0
        ? Number(((this.successCount / this.operations.length) * 100).toFixed(2))
        : 0,
      elapsedMs: elapsed,
      elapsedFormatted: this._formatTime(elapsed),
      endpointStats: { ...this.endpointStats },
      errorsByType: { ...this.errorsByType },
      errors: [...this.errors],
      lastErrors: this.errors.slice(-20),
      healthStatus: this._getHealthStatus()
    };
  }

  _getHealthStatus() {
    if (this.operations.length === 0) return 'idle';
    const rate = this.successCount / this.operations.length;
    if (rate >= 0.95) return 'excellent';
    if (rate >= 0.85) return 'good';
    if (rate >= 0.70) return 'warning';
    return 'critical';
  }

  _formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  getEndpointRanking() {
    return Object.entries(this.endpointStats)
      .map(([key, stats]) => ({
        endpoint: key,
        calls: stats.calls,
        successes: stats.successes,
        errors: stats.errors,
        successRate: stats.calls > 0 ? Number(((stats.successes / stats.calls) * 100).toFixed(1)) : 0,
        avgResponseTime: stats.calls > 0 ? Math.round(stats.totalTime / stats.calls) : 0,
        errorsByCode: stats.errorsByCode
      }))
      .sort((a, b) => b.errors - a.errors);
  }

  getAnomalies() {
    const anomalies = [];

    // Find endpoints with low success rate
    for (const [endpoint, stats] of Object.entries(this.endpointStats)) {
      const rate = stats.calls > 0 ? stats.successes / stats.calls : 1;
      if (rate < 0.7 && stats.calls >= 3) {
        anomalies.push({
          type: 'low_success_rate',
          severity: rate < 0.5 ? 'critical' : 'warning',
          endpoint,
          message: `Endpoint ${endpoint} tiene ${((1 - rate) * 100).toFixed(0)}% de errores (${stats.errors}/${stats.calls})`,
          rate: Number((rate * 100).toFixed(1))
        });
      }
    }

    // Find slow endpoints
    for (const [endpoint, stats] of Object.entries(this.endpointStats)) {
      const avg = stats.calls > 0 ? stats.totalTime / stats.calls : 0;
      if (avg > 2000 && stats.calls >= 2) {
        anomalies.push({
          type: 'slow_endpoint',
          severity: avg > 5000 ? 'critical' : 'warning',
          endpoint,
          message: `Endpoint ${endpoint} promedio ${Math.round(avg)}ms (${stats.calls} llamadas)`,
          avgTime: Math.round(avg)
        });
      }
    }

    // Check for validation errors pattern
    for (const [endpoint, count] of Object.entries(this.errorsByType.validation)) {
      if (count >= 3) {
        anomalies.push({
          type: 'validation_pattern',
          severity: 'warning',
          endpoint,
          message: `${count} errores de validación en ${endpoint} — posible problema de esquema`
        });
      }
    }

    return anomalies;
  }

  reset() {
    this.errors = [];
    this.operations = [];
    this.startTime = Date.now();
    this.endpointStats = {};
    this.errorsByType = { http: {}, validation: {}, schema: {}, permission: {}, timeout: 0, unknown: 0 };
    this.successCount = 0;
    this.errorCount = 0;
  }
}

module.exports = { ErrorTracker };