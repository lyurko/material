(function() {
  'use strict';


  angular.module('material.components.datepicker')
      .directive('mdCalendarMonthView', mdCalendarMonthViewDirective);

  /**
   * Height of one calendar month tbody. This must be made known to the virtual-repeat and is
   * subsequently used for scrolling to specific months.
   */
  var TBODY_HEIGHT = 265;

  /**
   * Height of a calendar month with a single row. This is needed to calculate the offset for
   * rendering an extra month in virtual-repeat that only contains one row.
   */
  var TBODY_SINGLE_ROW_HEIGHT = 45;

  /**
   * Private directive consumed by md-calendar. TODO: Update this.
   */
  function mdCalendarMonthViewDirective() {
    return {
      template: 
          '<table aria-hidden="true" class="md-calendar-day-header"><thead></thead></table>' +
          '<div class="md-calendar-scroll-mask">' +
            '<md-virtual-repeat-container class="md-calendar-scroll-container" ' +
                'md-offset-size="' + (TBODY_SINGLE_ROW_HEIGHT - TBODY_HEIGHT) + '">' +
              '<table role="grid" tabindex="0" class="md-calendar" aria-readonly="true">' +
                '<tbody role="rowgroup" md-virtual-repeat="i in ctrl.items" md-calendar-month ' +
                    'md-month-offset="$index" class="md-calendar-month" ' +
                    'md-start-index="ctrl.getFocusedMonthIndex()" ' +
                    'md-item-size="' + TBODY_HEIGHT + '"></tbody>' +
              '</table>' +
            '</md-virtual-repeat-container>' +
          '</div>',
      scope: {
        minDate: '=mdMinDate',
        maxDate: '=mdMaxDate',
        focusDate: '=mdFocusDate',
      },
      require: [
        '^ngModel',
        '^mdCalendar',
        'mdCalendarMonthView'
      ],
      controller: CalendarMonthViewCtrl,
      controllerAs: 'ctrl',
      bindToController: true,
      link: function(scope, element, attrs, controllers) {
        var ngModelCtrl = controllers[0];
        var calendarCtrl = controllers[1];
        var monthViewCtrl = controllers[2];
        monthViewCtrl.calendarCtrl = calendarCtrl;
        monthViewCtrl.configureNgModel(ngModelCtrl);
        calendarCtrl.$scope.$on('focus', function() {
          monthViewCtrl.focus();
        });
      }
    };
  }

  /** Class applied to the selected date cell/. */
  var SELECTED_DATE_CLASS = 'md-calendar-selected-date';

  /** Class applied to the focused date cell/. */
  var FOCUSED_DATE_CLASS = 'md-focus';

  /**
   * Controller for the mdCalendar component.
   * @ngInject @constructor
   */
  function CalendarMonthViewCtrl($element, $attrs, $scope, $animate, $q, $mdConstant,
      $mdTheming, $$mdDateUtil, $mdDateLocale, $mdInkRipple, $mdUtil) {
    $mdTheming($element);
    /**
     * Dummy array-like object for virtual-repeat to iterate over. The length is the total
     * number of months that can be viewed. This is shorter than ideal because of (potential)
     * Firefox bug https://bugzilla.mozilla.org/show_bug.cgi?id=1181658.
     */
    this.items = {length: 2000};

    if (this.maxDate && this.minDate) {
      // Limit the number of months if min and max dates are set.
      var numMonths = $$mdDateUtil.getMonthDistance(this.minDate, this.maxDate) + 1;
      numMonths = Math.max(numMonths, 1);
      // Add an additional month as the final dummy month for rendering purposes.
      numMonths += 1;
      this.items.length = numMonths;
    }

    /** @final {!angular.$animate} */
    this.$animate = $animate;

    /** @final {!angular.$q} */
    this.$q = $q;

    /** @final */
    this.$mdInkRipple = $mdInkRipple;

    /** @final */
    this.$mdUtil = $mdUtil;

    /** @final */
    this.keyCode = $mdConstant.KEY_CODE;

    /** @final */
    this.dateUtil = $$mdDateUtil;

    /** @final */
    this.dateLocale = $mdDateLocale;

    /** @final {!angular.JQLite} */
    this.$element = $element;

    /** @final {!angular.Scope} */
    this.$scope = $scope;

    /** @final {HTMLElement} */
    this.calendarElement = $element[0].querySelector('.md-calendar');

    /** @final {HTMLElement} */
    this.calendarScroller = $element[0].querySelector('.md-virtual-repeat-scroller');

    /** @final {Date} */
    this.today = this.dateUtil.createDateAtMidnight();

    /** 
     * The first renderable date in the virtual-scrolling calendar.
     * @type {Date}
     */
    this.firstRenderableDate = this.dateUtil.incrementMonths(this.today, -this.items.length / 2);

    if (this.minDate && this.minDate > this.firstRenderableDate) {
      this.firstRenderableDate = this.minDate;
    } else if (this.maxDate) {
      // Calculate the difference between the start date and max date.
      // Subtract 1 because it's an inclusive difference and 1 for the final dummy month.
      //
      var monthDifference = this.items.length - 2;
      this.firstRenderableDate = this.dateUtil.incrementMonths(this.maxDate, -(this.items.length - 2));
    }


    /** @type {!angular.NgModelController} */
    this.ngModelCtrl = null;

    /**
     * The selected date. Keep track of this separately from the ng-model value so that we
     * can know, when the ng-model value changes, what the previous value was before its updated
     * in the component's UI.
     *
     * @type {Date}
     */
    this.selectedDate = null;

    /**
     * The date that is currently focused or showing in the calendar. This will initially be set
     * to the ng-model value if set, otherwise to today. It will be updated as the user navigates
     * to other months. The cell corresponding to the displayDate does not necesarily always have
     * focus in the document (such as for cases when the user is scrolling the calendar).
     * @type {Date}
     */
    this.displayDate = null;

    /**
     * The date that has or should have focus.
     * @type {Date}
     */
    this.focusDate;

    /** @type {boolean} */
    this.isInitialized = false;

    /** @type {boolean} */
    this.isMonthTransitionInProgress = false;

    // Unless the user specifies so, the calendar should not be a tab stop.
    // This is necessary because ngAria might add a tabindex to anything with an ng-model
    // (based on whether or not the user has turned that particular feature on/off).
    if (!$attrs['tabindex']) {
      $element.attr('tabindex', '-1');
    }

    var self = this;

    /**
     * Handles a click event on a date cell.
     * Created here so that every cell can use the same function instance.
     * @this {HTMLTableCellElement} The cell that was clicked.
     */
    this.cellClickHandler = function() {
      var cellElement = this;
      if (this.hasAttribute('data-timestamp')) {
        $scope.$apply(function() {
          var timestamp = Number(cellElement.getAttribute('data-timestamp'));
          self.setNgModelValue(self.dateUtil.createDateAtMidnight(timestamp));
        });
      }
    };

    /**
     * Handles a click event on a label cell by switching the calendar to the year view.
     * Created here so that every label can use the same function instance.
     * @this {HTMLTableCellElement} The label that was clicked.
     */
    this.labelClickHandler = function() {
      var cellElement = this;
      if (cellElement.hasAttribute('data-timestamp')) {
        $scope.$apply(function() {
          var timestamp = Number(cellElement.getAttribute('data-timestamp'));
          self.calendarCtrl.focusDate = self.dateUtil.createDateAtMidnight(timestamp);
          self.calendarCtrl.isMonthViewActive = false;
        });
      }
    };

    this.attachCalendarEventListeners();
  }


  /*** Initialization ***/

  /**
   * Sets up the controller's reference to ngModelController.
   * @param {!angular.NgModelController} ngModelCtrl
   */
  CalendarMonthViewCtrl.prototype.configureNgModel = function(ngModelCtrl) {
    this.ngModelCtrl = ngModelCtrl;

    var self = this;
    ngModelCtrl.$render = function() {
      self.changeSelectedDate(self.ngModelCtrl.$viewValue, true);
    };

    if (ngModelCtrl.$viewValue) {
      self.selectedDate = ngModelCtrl.$viewValue;
      self.changeFocusDate(self.focusDate);
    }
  };

  /**
   * Initialize the calendar by building the months that are initially visible.
   * Initialization should occur after the ngModel value is known.
   */
  CalendarMonthViewCtrl.prototype.buildInitialCalendarDisplay = function() {
    this.buildWeekHeader();
    this.hideVerticalScrollbar();
    this.isInitialized = true;
  };

  /**
   * Hides the vertical scrollbar on the calendar scroller by setting the width on the
   * calendar scroller and the `overflow: hidden` wrapper around the scroller, and then setting
   * a padding-right on the scroller equal to the width of the browser's scrollbar.
   *
   * This will cause a reflow.
   */
  CalendarMonthViewCtrl.prototype.hideVerticalScrollbar = function() {
    var element = this.$element[0];

    var scrollMask = element.querySelector('.md-calendar-scroll-mask');
    var scroller = this.calendarScroller;

    var headerWidth = element.querySelector('.md-calendar-day-header').clientWidth;
    var scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;

    scrollMask.style.width = headerWidth + 'px';
    scroller.style.width = (headerWidth + scrollbarWidth) + 'px';
    scroller.style.paddingRight = scrollbarWidth + 'px';
  };


  /** Attach event listeners for the calendar. */
  CalendarMonthViewCtrl.prototype.attachCalendarEventListeners = function() {
    // Keyboard interaction.
    this.$element.on('keydown', angular.bind(this, this.handleKeyEvent));
  };
  
  /*** User input handling ***/

  /**
   * Handles a key event in the calendar with the appropriate action. The action will either
   * be to select the focused date or to navigate to focus a new date.
   * @param {KeyboardEvent} event
   */
  CalendarMonthViewCtrl.prototype.handleKeyEvent = function(event) {
    var self = this;
    this.$scope.$apply(function() {
      // Capture escape and emit back up so that a wrapping component
      // (such as a date-picker) can decide to close.
      if (event.which == self.keyCode.ESCAPE || event.which == self.keyCode.TAB) {
        self.$scope.$emit('md-calendar-close');

        if (event.which == self.keyCode.TAB) {
          event.preventDefault();
        }

        return;
      }

      // Remaining key events fall into two categories: selection and navigation.
      // Start by checking if this is a selection event.
      if (event.which === self.keyCode.ENTER) {
        self.setNgModelValue(self.displayDate);
        event.preventDefault();
        return;
      }

      // Selection isn't occuring, so the key event is either navigation or nothing.
      var date = self.getFocusDateFromKeyEvent(event);
      if (date) {
        date = self.boundDateByMinAndMax(date);
        event.preventDefault();
        event.stopPropagation();

        // Since this is a keyboard interaction, actually give the newly focused date keyboard
        // focus after the been brought into view.
        self.changeFocusDate(date);
      }
    });
  };

  CalendarMonthViewCtrl.prototype.changeFocusDate = function(date) {
    var self = this;
    self.changeDisplayDate(date).then(function () {
      self.focus(date);
    });
  };

  /**
   * Gets the date to focus as the result of a key event.
   * @param {KeyboardEvent} event
   * @returns {Date} Date to navigate to, or null if the key does not match a calendar shortcut.
   */
  CalendarMonthViewCtrl.prototype.getFocusDateFromKeyEvent = function(event) {
    var dateUtil = this.dateUtil;
    var keyCode = this.keyCode;

    switch (event.which) {
      case keyCode.RIGHT_ARROW: return dateUtil.incrementDays(this.displayDate, 1);
      case keyCode.LEFT_ARROW: return dateUtil.incrementDays(this.displayDate, -1);
      case keyCode.DOWN_ARROW:
        return event.metaKey ?
          dateUtil.incrementMonths(this.displayDate, 1) :
          dateUtil.incrementDays(this.displayDate, 7);
      case keyCode.UP_ARROW:
        return event.metaKey ?
          dateUtil.incrementMonths(this.displayDate, -1) :
          dateUtil.incrementDays(this.displayDate, -7);
      case keyCode.PAGE_DOWN: return dateUtil.incrementMonths(this.displayDate, 1);
      case keyCode.PAGE_UP: return dateUtil.incrementMonths(this.displayDate, -1);
      case keyCode.HOME: return dateUtil.getFirstDateOfMonth(this.displayDate);
      case keyCode.END: return dateUtil.getLastDateOfMonth(this.displayDate);
      default: return null;
    }
  };

  /**
   * Gets the "index" of the currently selected date as it would be in the virtual-repeat.
   * @returns {number}
   */
  CalendarMonthViewCtrl.prototype.getFocusedMonthIndex = function() {
    return this.dateUtil.getMonthDistance(this.firstRenderableDate,
        this.focusDate || this.selectedDate || this.today);
  };

  /**
   * Scrolls to the month of the given date.
   * @param {Date} date
   */
  CalendarMonthViewCtrl.prototype.scrollToMonth = function(date) {
    if (!this.dateUtil.isValidDate(date)) {
      return;
    }

    var monthDistance = this.dateUtil.getMonthDistance(this.firstRenderableDate, date);
    this.calendarScroller.scrollTop = monthDistance * TBODY_HEIGHT;
  };

  /**
   * Sets the ng-model value for the calendar and emits a change event from the parent controller.
   * @param {Date} date
   */
  CalendarMonthViewCtrl.prototype.setNgModelValue = function(date) {
    this.calendarCtrl.$scope.$emit('md-calendar-change', date);
    this.ngModelCtrl.$setViewValue(date);
    this.ngModelCtrl.$render();
  };

  /**
   * Focus the cell corresponding to the given date.
   * @param {Date=} opt_date
   */
  CalendarMonthViewCtrl.prototype.focus = function(opt_date) {
    var date = opt_date || this.selectedDate || this.today;

    var previousFocus = this.calendarElement.querySelector('.md-focus');
    if (previousFocus) {
      previousFocus.classList.remove(FOCUSED_DATE_CLASS);
    }

    var cellId = this.getDateId(date);
    var cell = document.getElementById(cellId);
    if (cell) {
      cell.classList.add(FOCUSED_DATE_CLASS);
      cell.focus();
    } else {
      this.focusDate = date;
    }
  };

  /**
   * If a date exceeds minDate or maxDate, returns date matching minDate or maxDate, respectively.
   * Otherwise, returns the date.
   * @param {Date} date
   * @return {Date}
   */
  CalendarMonthViewCtrl.prototype.boundDateByMinAndMax = function(date) {
    var boundDate = date;
    if (this.minDate && date < this.minDate) {
      boundDate = new Date(this.minDate.getTime());
    }
    if (this.maxDate && date > this.maxDate) {
      boundDate = new Date(this.maxDate.getTime());
    }
    return boundDate;
  };

  /*** Updating the displayed / selected date ***/

  /**
   * Change the selected date in the calendar (ngModel value has already been changed).
   * @param {Date} date
   * @param {boolean} opt_updateDisplay Changes the display date to match the selected date.
   */
  CalendarMonthViewCtrl.prototype.changeSelectedDate = function(date, opt_updateDisplay) {
    var self = this;
    var previousSelectedDate = this.selectedDate;
    this.selectedDate = date;

    var promise = opt_updateDisplay ? 
        this.changeDisplayDate(date) :
        this.$q.resolve();
    promise.then(function() {

      // Remove the selected class from the previously selected date, if any.
      if (previousSelectedDate) {
        var prevDateCell =
            document.getElementById(self.getDateId(previousSelectedDate));
        if (prevDateCell) {
          prevDateCell.classList.remove(SELECTED_DATE_CLASS);
          prevDateCell.setAttribute('aria-selected', 'false');
        }
      }

      // Apply the select class to the new selected date if it is set.
      if (date) {
        var dateCell = document.getElementById(self.getDateId(date));
        if (dateCell) {
          dateCell.classList.add(SELECTED_DATE_CLASS);
          dateCell.setAttribute('aria-selected', 'true');
        }
      }
    });
  };


  /**
   * Change the date that is being shown in the calendar. If the given date is in a different
   * month, the displayed month will be transitioned.
   * @param {Date} date
   */
  CalendarMonthViewCtrl.prototype.changeDisplayDate = function(date) {
    // Initialization is deferred until this function is called because we want to reflect
    // the starting value of ngModel.
    if (!this.isInitialized) {
      this.buildInitialCalendarDisplay();
      return this.$q.when();
    }

    // If trying to show an invalid date or a transition is in progress, do nothing.
    if (!this.dateUtil.isValidDate(date) || this.isMonthTransitionInProgress) {
      return this.$q.when();
    }

    this.isMonthTransitionInProgress = true;
    var animationPromise = this.animateDateChange(date);

    this.displayDate = date;

    var self = this;
    animationPromise.then(function() {
      self.isMonthTransitionInProgress = false;
    });

    return animationPromise;
  };

  /**
   * Animates the transition from the calendar's current month to the given month.
   * @param {Date} date
   * @returns {angular.$q.Promise} The animation promise.
   */
  CalendarMonthViewCtrl.prototype.animateDateChange = function(date) {
    this.scrollToMonth(date);
    return this.$q.when();
  };

  /*** Constructing the calendar table ***/

  /**
   * Builds and appends a day-of-the-week header to the calendar.
   * This should only need to be called once during initialization.
   */
  CalendarMonthViewCtrl.prototype.buildWeekHeader = function() {
    var firstDayOfWeek = this.dateLocale.firstDayOfWeek;
    var shortDays = this.dateLocale.shortDays;

    var row = document.createElement('tr');
    for (var i = 0; i < 7; i++) {
      var th = document.createElement('th');
      th.textContent = shortDays[(i + firstDayOfWeek) % 7];
      row.appendChild(th);
    }

    this.$element.find('thead').append(row);
  };

  /**
   * Gets an identifier for a date unique to the calendar instance for internal
   * purposes. Not to be displayed.
   * @param {Date} date
   * @returns {string}
   */
  CalendarMonthViewCtrl.prototype.getDateId = function(date) {
    return [
      'md',
      this.calendarCtrl.id,
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    ].join('-');
  };
})();
