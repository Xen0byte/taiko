const Element = require("./element");
const { descEvent } = require("../eventBus");
const { doActionAwaitingNavigation } = require("../doActionAwaitingNavigation");
const { setNavigationOptions } = require("../config");
const { defaultConfig } = require("../config");
const { highlightElement } = require("./elementHelper");
const { isDate } = require("../helper");

class TimeField extends Element {
  async value() {
    function getValue() {
      return this.value;
    }
    const options = { objectId: this.get() };
    const { result } = await this.runtimeHandler.runtimeCallFunctionOn(
      getValue,
      null,
      options,
    );
    return result.value;
  }
  async select(dateTime) {
    if (defaultConfig.headful) {
      await highlightElement(this);
    }

    if (!isDate(dateTime)) {
      throw TypeError("Value should be an instance of Date");
    }

    function selectDate(value) {
      Date.prototype.getWeekNumber = function () {
        const d = new Date(
          Date.UTC(this.getFullYear(), this.getMonth(), this.getDate()),
        );
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
      }; //https://stackoverflow.com/questions/6117814/get-week-of-year-in-javascript-like-in-php

      function getDateOfISOWeek(w, y) {
        const simple = new Date(y, 0, 1 + (w - 1) * 7);
        const dow = simple.getDay();
        const ISOweekStart = simple;
        if (dow <= 4) {
          ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
        } else {
          ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
        }
        return ISOweekStart;
      } //https://stackoverflow.com/questions/16590500/javascript-calculate-date-from-week-number

      function getDateForTime(hour, min) {
        const date = new Date();
        date.setHours(hour);
        date.setMinutes(min);
        return date;
      }

      const dateValue = new Date(value);

      const setAndDispatchEvent = (self, v) => {
        self.value = v;
        for (const ev of ["change", "input"]) {
          const event = new Event(ev, { bubbles: true });
          try {
            self.dispatchEvent(event);
          } catch (e) {
            return {
              error: `Error occurred while dispatching ${ev} event`,
              stack: e.stack,
            };
          }
        }
        return true;
      };

      const validationDateFormat = {
        week: (self) => {
          return {
            max: self.max
              ? getDateOfISOWeek(self.max.slice(-2), self.max.slice(0, 4))
              : null,
            min: self.min
              ? getDateOfISOWeek(self.min.slice(-2), self.min.slice(0, 4))
              : null,
          };
        },
        month: (self) => {
          return {
            max: self.max
              ? new Date(
                  self.max.slice(0, 4),
                  Number.parseInt(self.max.slice(-2)) + 1,
                  0,
                )
              : null,
            min: self.min
              ? new Date(
                  self.min.slice(0, 4),
                  Number.parseInt(self.min.slice(-2)) + 1,
                  1,
                )
              : null,
          };
        },
        time: (self) => {
          return {
            max: self.max
              ? getDateForTime(self.max.slice(0, 2), self.max.slice(-2))
              : null,
            min: self.min
              ? getDateForTime(self.min.slice(0, 2), self.min.slice(-2))
              : null,
          };
        },
      };

      const validate = (self, value) => {
        const { min, max } = validationDateFormat[self.type]
          ? validationDateFormat[self.type](self)
          : {
              min: self.min ? new Date(self.min) : null,
              max: self.max ? new Date(self.max) : null,
            };
        if (max && min) {
          return max >= value && min <= value;
        }
        if (max) {
          return max >= value;
        }
        if (min) {
          return min <= value;
        }
        return true;
      };

      const dateFormat = {
        date: `${dateValue.getFullYear()}-${`0${dateValue.getMonth() + 1}`.slice(-2)}-${`0${dateValue.getDate()}`.slice(-2)}`,
        "datetime-local": `${dateValue.getFullYear()}-${`0${dateValue.getMonth() + 1}`.slice(-2)}-${`0${dateValue.getDate()}`.slice(-2)}T${`0${dateValue.getHours()}`.slice(-2)}:${`0${dateValue.getMinutes()}`.slice(-2)}`,
        month: `${dateValue.getFullYear()}-${`0${dateValue.getMonth() + 1}`.slice(-2)}`,
        time: `${`0${dateValue.getHours()}`.slice(-2)}:${`0${dateValue.getMinutes()}`.slice(-2)}`,
        week: `${dateValue.getFullYear()}-W${`0${dateValue.getWeekNumber()}`.slice(-2)}`,
      };

      const dateTimeValue = validate(this, dateValue)
        ? dateFormat[this.type]
        : {
            error: `Value should be${this.min ? ` minimum of ${this.min}` : ""}${
              this.max ? ` maximum of ${this.max}` : ""
            }`,
          };

      setAndDispatchEvent(this, dateTimeValue);
      return dateTimeValue;
    }

    const navigationOptions = setNavigationOptions({});
    await doActionAwaitingNavigation(navigationOptions, async () => {
      const options = {
        objectId: this.get(),
        arg: dateTime,
        returnByValue: true,
      };
      const { result } = await this.runtimeHandler.runtimeCallFunctionOn(
        selectDate,
        null,
        options,
      );
      const { stack, error } = result.value;
      if (stack || error) {
        throw new Error(`${error} \n ${stack ? stack : ""}`);
      }
      descEvent.emit("success", `DateTime value (${result.value}) selected`);
    });
  }
  static from(element, description) {
    return new TimeField(element.get(), description, element.runtimeHandler);
  }
}

module.exports = TimeField;
