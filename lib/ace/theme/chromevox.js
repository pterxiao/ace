define(function(require, exports, module) {
  /* ChromeVox Ace namespace. */
  var cvoxAce = {};

  /**
   * @typedef {{
      rate: number,
      pitch: number,
      volume: number,
      relativePitch: number,
      punctuationEcho: string
     }}
   */
  /* TODO(peterxiao): Export this typedef through cvox.Api. */
  cvoxAce.SpeechProperty;

  /**
   * @typedef {{
   *   row: number,
   *   column: number
   * }}
   */
  cvoxAce.Cursor;

  /**
   * @typedef {{
      type: string,
      value: string
     }}
   }
   */
  cvoxAce.Token;

  /**
   * These are errors and information that Ace will display in the gutter.
   * @typedef {{
      row: number,
      column: number,
      value: string
     }}
   }
   */
  cvoxAce.Annotation;

  /* Speech Properties. */
  /**
   * @type {cvoxAce.SpeechProperty}
   */
  var CONSTANT_PROP = {
    'rate': 0.8,
    'pitch': 0.4,
    'volume': 0.9
  };

  /**
   * @type {cvoxAce.SpeechProperty}
   */
  var DEFAULT_PROP = {
    'rate': 1,
    'pitch': 0.5,
    'volume': 0.9
  };

  /**
   * @type {cvoxAce.SpeechProperty}
   */
  var ENTITY_PROP = {
    'rate': 0.8,
    'pitch': 0.8,
    'volume': 0.9
  };

  /**
   * @type {cvoxAce.SpeechProperty}
   */
  var KEYWORD_PROP = {
    'rate': 0.8,
    'pitch': 0.3,
    'volume': 0.9
  };

  /**
   * @type {cvoxAce.SpeechProperty}
   */
  var STORAGE_PROP = {
    'rate': 0.8,
    'pitch': 0.7,
    'volume': 0.9
  };

  /**
   * @type {cvoxAce.SpeechProperty}
   */
  var VARIABLE_PROP = {
    'rate': 0.8,
    'pitch': 0.8,
    'volume': 0.9
  };

  /**
   * @type {cvoxAce.SpeechProperty}
   */
  var DELETED_PROP = {
    'punctuationEcho': 'none',
    'relativePitch': -0.6
  };

  var ERROR_EARCON = 'ALERT_NONMODAL';
  var MODE_SWITCH_EARCON = 'ALERT_MODAL';
  var NO_MATCH_EARCON = 'INVALID_KEYPRESS';
  var INSERT_MODE_STATE = 'insertMode';
  var COMMAND_MODE_STATE = 'start';

  /**
   * Context menu commands.
   */
  var Command = {
    SPEAK_ANNOT: 'annots',
    SPEAK_ALL_ANNOTS: 'all_annots',
    TOGGLE_LOCATION: 'toggle_location',
    SPEAK_MODE: 'mode',
    SPEAK_ROW_COL: 'row_col',
    TOGGLE_DISPLACEMENT: 'toggle_displacement'
  };

  /**
   * Key prefix for each shortcut.
   */
  var KEY_PREFIX = 'CONTROL + SHIFT ';

  /* Globals. */
  /**
   * Last cursor position.
   * @type {!cvoxAce.Cursor}
   */
  var lastCursor = ace.selection.getCursor();

  /**
   * Table of annotations.
   * @typedef {!Object.<number, Object<number, cvoxAce.Annotation>>}
   */
  var annotTable = {};

  /**
   * Whether to speak character, word, and then line.
   * @typedef {boolean}
   */
  var shouldSpeakRowLocation = false;

  /**
   * Whether to speak displacement.
   * @typedef {boolean}
   */
  var shouldSpeakDisplacement = false;

  /**
   * Whether text was changed to cause a cursor change event.
   * @typedef {boolean}
   */
  var changed = false;

  /**
   * Current state vim is in.
   */
  var vimState = null;

  /**
   * Mapping from key code to shortcut.
   */
  var keyCodeToShortcutMap = {};

  /**
   * Mapping from command to shortcut.
   */
  var cmdToShortcutMap = {};

  /**
   * Get shortcut string from keyCode.
   * @param {number} keyCode Key code of shortcut.
   * @return {string} String representation of shortcut.
   */
  var getKeyShortcutString = function(keyCode) {
    return KEY_PREFIX + String.fromCharCode(keyCode);
  };

  /**
   * Return if in vim mode.
   * @return {boolean} True if in Vim mode.
   */
  var isVimMode = function() {
    return ace.keyBinding.getKeyboardHandler().$id === 'ace/keyboard/vim';
  };

  /**
   * Gets the lines of code.
   * @return {Array.<string>} The lines.
   */
  var getLines = function() {
    return ace.getValue().split('\n');
  };

  /**
   * Gets the current token.
   * @param {!cvoxAce.Cursor} cursor Current position of the cursor.
   * @return {!cvoxAce.Token} Token at the current position.
   */
  var getCurrentToken = function(cursor) {
    return ace.getSession().getTokenAt(cursor.row, cursor.column + 1);
  };

  /**
   * Gets the current line the cursor is under.
   * @param {!cvoxAce.Cursor} cursor Current cursor position.
   */
  var getCurrentLine = function(cursor) {
    return ace.getSession().getLine(cursor.row);
  };

  /**
   * Event handler for row changes.
   * @param {!cvoxAce.Cursor} currCursor Current cursor position.
   */
  var onRowChange = function(currCursor) {
    /* Notify that this line has an annotation. */
    if (annotTable[currCursor.row]) {
      cvox.Api.playEarcon(ERROR_EARCON);
    }
    if (shouldSpeakRowLocation) {
      cvox.Api.stop();
      speakChar(currCursor);
      speakTokenQueue(getCurrentToken(currCursor));
      speakLine(currCursor.row, 1);
    } else {
      speakLine(currCursor.row, 0);
    }
  };

  /**
   * Returns whether the cursor is at the beginning of a word. A word is
   * a grouping of alphanumeric characters including underscores.
   * @param {!cvoxAce.Cursor} cursor Current cursor position.
   * @return {boolean} Whether there is word.
   */
  var isWord = function(cursor) {
    var line = getCurrentLine(cursor);
    var lineSuffix = line.substr(cursor.column - 1);
    if (cursor.column === 0) {
      lineSuffix = ' ' + line;
    }
    var firstWordRegExp = /^\W(\w+)/;
    var words = firstWordRegExp.exec(lineSuffix);
    return words !== null;
  };

  /**
   * A mapping of syntax type to speech properties.
   */
  var rules = {
    'constant': CONSTANT_PROP,
    'entity': ENTITY_PROP,
    'keyword': KEYWORD_PROP,
    'storage': STORAGE_PROP,
    'variable': VARIABLE_PROP
  };

  /**
   * Speak the line with syntax properties.
   * @param {number} row Row to speak.
   * @param {number} queue Queue mode to speak.
   */
  var speakLine = function(row, queue) {
    var tokens = ace.getSession().getTokens(row);
    if (tokens.length === 0) {
      return;
    }
    var firstToken = tokens[0];
    tokens = tokens.filter(function(token) {
      return token !== firstToken && token.type !== 'text';
    });
    speakToken_(firstToken, queue);
    tokens.forEach(speakTokenQueue);
  };

  /**
   * Speak the token based on the syntax of the token, flushing.
   * @param {!cvoxAce.Token} token Token to speak.
   * @param {number} queue Queue mode.
   */
  var speakTokenFlush = function(token) {
    speakToken_(token, 0);
  };

  /**
   * Speak the token based on the syntax of the token, queueing.
   * @param {!cvoxAce.Token} token Token to speak.
   * @param {number} queue Queue mode.
   */
  var speakTokenQueue = function(token) {
    speakToken_(token, 1);
  };

  /**
   * Speak the token based on the syntax of the token.
   * @private
   * @param {!cvoxAce.Token} token Token to speak.
   * @param {number} queue Queue mode.
   */
  var speakToken_ = function(token, queue) {
    /* Types are period delimited. In this case, we only syntax speak the outer
     * most type of token. */
    var type = token.type.split('.')[0];
    var prop = rules[type];
    if (!prop) {
      prop = DEFAULT_PROP;
    }
    cvox.Api.speak(token.value, queue, prop);
  };

  /**
   * Speaks the character under the cursor.
   * @param {!cvoxAce.Cursor} cursor Current cursor position.
   * @return {string} Character.
   */
  var speakChar = function(cursor) {
    var line = getCurrentLine(cursor);
    cvox.Api.speak(line[cursor.column], 1);
  };

  /**
   * Speaks the jump from lastCursor to currCursor. This function assumes the
   * jump takes place on the current line.
   * @param {!cvoxAce.Cursor} lastCursor Previous cursor position.
   * @param {!cvoxAce.Cursor} currCursor Current cursor position.
   */
  var speakDisplacement = function(lastCursor, currCursor) {
    cvox.Api.stop();
    var line = getCurrentLine(currCursor);

    var displace = line.substring(lastCursor.column, currCursor.column);
    /* When going forward one space, we speak where we land. */
    if (currCursor.column - lastCursor.column === 1) {
      displace = line.substring(lastCursor.column + 1, currCursor.column + 1);
    }
    /* Speak out loud spaces. */
    displace = displace.replace(/ /g, ' space ');
    cvox.Api.speak(displace, 1);
  };

  /**
   * Speaks the word if the cursor jumped to a new word or to the beginning
   * of the line. Otherwise speak the charactor.
   * @param {!cvoxAce.Cursor} lastCursor Previous cursor position.
   * @param {!cvoxAce.Cursor} currCursor Current cursor position.
   */
  var speakCharOrWordOrLine = function(lastCursor, currCursor) {
    /* Say word only if jump. */
    if (Math.abs(lastCursor.column - currCursor.column) !== 1) {
      var currLineLength = getCurrentLine(currCursor).length;
      /* Speak line if jumping to beginning or end of line. */
      if (currCursor.column === 0 || currCursor.column === currLineLength) {
        speakLine(currCursor.row, 0);
        return;
      }
      if (isWord(currCursor)) {
        cvox.Api.stop();
        speakTokenQueue(getCurrentToken(currCursor));
        return;
      }
    }
    speakChar(currCursor);
  };

  /**
   * Event handler for column changes.
   * @param {!cvoxAce.Cursor} lastCursor Previous cursor position.
   * @param {!cvoxAce.Cursor} currCursor Current cursor position.
   */
  var onColumnChange = function(lastCursor, currCursor) {
    /* Do not speak if cursor change was a result of text insertion. */
    if (changed) {
      changed = false;
      return;
    }
    if (shouldSpeakDisplacement) {
      speakDisplacement(lastCursor, currCursor);
    } else {
      speakCharOrWordOrLine(lastCursor, currCursor);
    }
  };

  /**
   * Event handler for cursor changes.
   * @param {!Event} evt The event.
   */
  var onCursorChange = function(evt) {
    var currCursor = ace.selection.getCursor();
    if (currCursor.row !== lastCursor.row) {
      onRowChange(currCursor);
    } else {
      onColumnChange(lastCursor, currCursor);
    }
    lastCursor = currCursor;
  };

  /**
   * Event handler for source changes.
   * @param {!Event} evt The event.
   */
  var onChange = function(evt) {
    var data = evt.data;
    switch (data.action) {
    case 'removeText':
      cvox.Api.speak(data.text, 0, DELETED_PROP);
      changed = true;
      break;
    case 'insertText':
      /* Let next cursor change know there was an insertion. */
      cvox.Api.speak(data.text, 0);
      changed = true;
      break;
    }
  };

  /**
   * Returns whether or not the annotation is new.
   * @param {!cvoxAce.Annotation} annot Annotation in question.
   * @return {boolean} Whether annot is new.
   */
  var isNewAnnotation = function(annot) {
    var row = annot.row;
    var col = annot.column;
    return !annotTable[row] || !annotTable[row][col];
  };

  /**
   * Populates the annotation table.
   * @param {!Array.<cvoxAce.Annotation>} annotations Array of annotations.
   */
  var populateAnnotations = function(annotations) {
    annotTable = {};
    for (var i = 0; i < annotations.length; i++) {
      var annotation = annotations[i];
      var row = annotation.row;
      var col = annotation.column;
      if (!annotTable[row]) {
        annotTable[row] = {};
      }
      annotTable[row][col] = annotation;
    }
  };

  /**
   * Event handler for annotation changes.
   * @param {!Event} evt Event.
   */
  var onAnnotationChange = function(evt) {
    var annotations = ace.getSession().getAnnotations();
    var newAnnotations = annotations.filter(isNewAnnotation);
    if (newAnnotations.length > 0) {
      cvox.Api.playEarcon(ERROR_EARCON);
    }
    populateAnnotations(annotations);
  };

  /**
   * Speak annotation.
   * @param {!cvoxAce.Annotation} annot Annotation to speak.
   */
  var speakAnnot = function(annot) {
    var annotText = annot.type + ' ' + annot.text + ' on ' +
        rowColToString(annot.row, annot.column);
    annotText = annotText.replace(';', 'semicolon');
    cvox.Api.speak(annotText, 1);
  };

  /**
   * Speak annotations in a row.
   * @param {number} row Row of annotations to speak.
   */
  var speakAnnotsByRow = function(row) {
    var annots = annotTable[row];
    for (var col in annots) {
      speakAnnot(annots[col]);
    }
  };

  /**
   * @param {boolean} row Zero indexed row.
   * @param {boolean} col Zero indexed column.
   * @return {string} Row and column to be spoken.
   */
  var rowColToString = function(row, col) {
    return 'row ' + (row + 1) + ' column ' + (col + 1);
  };

  /**
   * Speaks the row and column.
   */
  var speakCurrRowAndCol = function() {
    cvox.Api.speak(rowColToString(lastCursor.row, lastCursor.column));
  };

  /**
   * Speaks all annotations.
   */
  var speakAllAnnots = function() {
    for (var row in annotTable) {
      speakAnnotsByRow(row);
    }
  };

  /**
   * Speak the vim mode. If no vim mode, this function does nothing.
   */
  var speakMode = function() {
    if (!isVimMode()) {
      return;
    }
    switch (ace.keyBinding.$data.state) {
    case INSERT_MODE_STATE:
      cvox.Api.speak('Insert mode');
      break;
    case COMMAND_MODE_STATE:
      cvox.Api.speak('Command mode');
      break;
    }
  };

  /**
   * Toggle speak location.
   */
  var toggleSpeakRowLocation = function() {
    shouldSpeakRowLocation = !shouldSpeakRowLocation;
    if (shouldSpeakRowLocation) {
      cvox.Api.speak('Speak location on row change enabled.');
    } else {
      cvox.Api.speak('Speak location on row change disabled.');
    }
  };

  /**
   * Toggle speak displacement.
   */
  var toggleSpeakDisplacement = function() {
    speakDisplacement = !speakDisplacement;
    if (speakDisplacement) {
      cvox.Api.speak('Speak displacement on column changes.');
    } else {
      cvox.Api.speak('Speak current character or word on column changes.');
    }
  };

  /**
   * Event handler for key down events.
   * @param {!Event} evt Keyboard event.
   */
  var onKeyDown = function(evt) {
    if (evt.ctrlKey && evt.shiftKey) {
      var shortcut = keyCodeToShortcutMap[evt.keyCode];
      if (shortcut) {
        shortcut.func();
      }
    }
  };

  /**
   * Event handler for status change events.
   * @param {!Event} evt Change status event.
   * @param {!Object} editor Editor state.
   */
  var onChangeStatus = function(evt, editor) {
    if (!isVimMode()) {
      return;
    }
    var state = editor.keyBinding.$data.state;
    if (state === vimState) {
      return;
    }
    switch (state) {
    case INSERT_MODE_STATE:
      cvox.Api.playEarcon(MODE_SWITCH_EARCON);
      cvox.Api.setKeyEcho(true);
      break;
    case COMMAND_MODE_STATE:
      cvox.Api.playEarcon(MODE_SWITCH_EARCON);
      cvox.Api.setKeyEcho(false);
      break;
    }
    vimState = state;
  };

  /**
   * Handles context menu events.
   * @param {Event} evt Event received.
   */
  var contextMenuHandler = function(evt) {
    var cmd = evt.detail['customCommand'];
    var shortcut = cmdToShortcutMap[cmd];
    if (shortcut) {
      shortcut.func();
    }
  };

  /**
   * Initialize the context menu.
   */
  var initContextMenu = function() {
    var ACTIONS = SHORTCUTS.map(function(shortcut) {
      return {
        desc: shortcut.desc + getKeyShortcutString(shortcut.keyCode),
        cmd: shortcut.cmd
      };
    });

    /* Attach ContextMenuActions. */
    var body = document.querySelector('body');
    body.setAttribute('contextMenuActions', JSON.stringify(ACTIONS));

    /* Listen for ContextMenu events. */
    body.addEventListener('ATCustomEvent', contextMenuHandler, true);
  };

  /**
   * Returns a mutations handler where f is applied to each mutation.
   * @param {function} f Function to be applied to mutations.
   */
  var getMutaHandler = function(f) {
    return function(mutations) {
      mutations.forEach(f);
    };
  };

  /**
   * Watches and handles the mutation that is a result of a search.
   * @param {Mutation} m Mutation.
   */
  var watchForSearch = function(m) {
    if (m.attributeName === 'class' &&
        m.target.className === 'ace_search_form ace_nomatch') {
      /* No match! */
      cvox.Api.playEarcon(NO_MATCH_EARCON);
    } else {
      /* Match! Speak the line. */
      speakLine(lastCursor.row, 0);
    }
  };

  /**
   * Configuration for mutation observer.
   */
  var MO_CONFIG = { attributes: true, childList: true, characterData: true};

  /**
   * Watches and handles the mutation that adds the search bar to the DOM.
   */
  var watchForStartSearch = function(m) {
    for (var i = 0; i < m.addedNodes.length; i++) {
      if (m.addedNodes.item(i).className === 'ace_search right') {
        var searchObs = new MutationObserver(getMutaHandler(watchForSearch));
        var target = m.addedNodes.item(i).querySelector('.ace_search_form');
        searchObs.observe(target, MO_CONFIG);
      }
    }
  };

  /**
   * Shortcut definitions.
   */
  var SHORTCUTS = [
    {
      /* 1 key. */
      keyCode: 49,
      func: function() {
        speakAnnotsByRow(lastCursor.row);
      },
      cmd: Command.SPEAK_ANNOT,
      desc: 'Speak annotations on line'
    },
    {
      /* 2 key. */
      keyCode: 50,
      func: speakAllAnnots,
      cmd: Command.SPEAK_ALL_ANNOTS,
      desc: 'Speak all annotations'
    },
    {
      /* 3 key. */
      keyCode: 51,
      func: speakMode,
      cmd: Command.SPEAK_MODE,
      desc: 'Speak Vim mode'
    },
    {
      /* 4 key. */
      keyCode: 52,
      func: toggleSpeakRowLocation,
      cmd: Command.TOGGLE_LOCATION,
      desc: 'Toggle speak row location'
    },
    {
      /* 5 key. */
      keyCode: 53,
      func: speakCurrRowAndCol,
      cmd: Command.SPEAK_ROW_COL,
      desc: 'Speak row and column'
    },
    {
      /* 6 key. */
      keyCode: 54,
      func: toggleSpeakDisplacement,
      cmd: Command.TOGGLE_DISPLACEMENT,
      desc: 'Toggle speak displacement'
    }
  ];

  /**
   * Initialization function.
   */
  var init = function() {
    SHORTCUTS.forEach(function(shortcut) {
      keyCodeToShortcutMap[shortcut.keyCode] = shortcut;
      cmdToShortcutMap[shortcut.cmd] = shortcut;
    });

    ace.getSession().selection.on('changeCursor', onCursorChange);
    ace.getSession().on('change', onChange);
    ace.getSession().on('changeAnnotation', onAnnotationChange);
    ace.on('changeStatus', onChangeStatus);
    window.addEventListener('keydown', onKeyDown);
    /* Assume we start in command mode if vim. */
    if (isVimMode()) {
      cvox.Api.setKeyEcho(false);
    }
    initContextMenu();

    var target = document.querySelector('.ace_editor');
    var observer = new MutationObserver(getMutaHandler(watchForStartSearch));

    observer.observe(target, MO_CONFIG);
  };

  /**
   * Returns if cvox exists, and the api exists.
   * @return {boolean} Whether not Cvox Api exists.
   */
  function cvoxApiExists() {
    return (typeof(cvox) !== 'undefined') && cvox && cvox.Api;
  }

  /**
   * Number of tries for Cvox loading.
   * @type {number}
   */
  var tries = 0;

  /**
   * Max number of tries to watch for Cvox loading.
   * @type {number}
   */
  var MAX_TRIES = 15;

  /**
   * Check for ChromeVox load.
   */
  function watchForCvoxLoad() {
    if (cvoxApiExists()) {
      init();
    } else {
      tries++;
      if (tries >= MAX_TRIES) {
        return;
      }
      window.setTimeout(watchForCvoxLoad, 500);
    }
  }
  watchForCvoxLoad();
});
