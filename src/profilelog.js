'use strict'

/**
 * Simple profile logging utility
 *
 * usage:
 *   const ProfileLog = require('./profilelog')
 *   profileLog = new ProfileLog('Test Performance')
 *   let start = new Date()
 *   ...do something being measured...
 *   profileLog.addEntry(start, 'Did something slow')
 *   start = new Date()
 *   ...do something being measured again...
 *   profileLog.addEntry(start, 'Did something slow again')
 *   profileLog.writeToConsole()
 *
 * output:
 *   Test Performance:
 *      11185: Did something slow
 *       2089: Did something slow again
 */
class ProfileLog {

  constructor(title = "Execution Profiling Log", enabled = true) {
    this.title = title
    this.enabled = enabled
    this.entries = []
  }

  /**
   * Clear the profiling info entries
   */
  clear() {
    this.entries = []
  }

  /**
   * Add profiling measurement info entry if 'enabled'.
   *
   * @param since {Date} to be used to calculate elapsed millisecs
   * @param message {string} description of measurement
   */
  addEntry(since, message) {
    if (this.enabled)
      this.entries.push(`${('      ' + (new Date() - since)).slice(-6)}: ${message}`)
  }

  /**
   * Write ProfileLog entries to console if 'enabled'.
   */
  writeToConsole() {
    if (this.enabled)
      console.log(`Execution Profiling Log:\n  ${this.entries.join("\n  ")}\n`)
  }

}


module.exports = ProfileLog
