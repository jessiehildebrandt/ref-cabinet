/*
 * index.js
 */

// TODO: CUSTOM DIALOGS AND PROMPTS! prompt() IS BAD! BAD!
// TODO: Clean this up! Eventually... (I mean, it works for now...)
// TODO: Better documentation!

/******************************/
/* Templates */

const tabHTMLTemplate =
      '<div id="!-tab" class="tab">@</div>';

const cardHTMLTemplate =
      '<div id="$-card" data-tab="!" data-populated="0" class="card">' +
      '<input id="$-input" class="searchbar" tabindex="1" "type="text" autocomplete="off" placeholder="Enter Keyword">' +
      '<div class="card-content">' +
      '<div id="$-results"></div>' +
      '</div>' +
      '</div>';

const cseTemplate = {
    div: '$-results',
    gname: '$-results',
    tag: 'searchresults-only',
    attributes: {
        disableWebSearch: true,
        safeSearch: 'active',
    },
};

/******************************/
/* Global variables */

// Session data
let currentTab = '0';
let cardCounter = 0;
let tabCounter = 0;

// Ephemeral data
// (We use a query queue on a timer to avoid overloading the custom search engine)
let queryQueue = [];
let importing = false;

/******************************/
/* Google Custom Search Engine and page initialization */

// This init function will make the app usable when GCSE is ready
const GCSEInit = function()
{

    /**********/
    /* enableApp
     * Adds the required behaviors to the page elements in order to make the app usable
     */

    function enableApp()
    {

        // Make sure that Web Storage is supported...
        if ( typeof( Storage ) === 'undefined' )
        {
            $( '#loading-wrapper' ).html(
                '<p style="color: #fcfcfc;">Sorry, but your browser does not support Web Storage, which RefCabinet requires to function.</p>'
            );
            window.stop();
            return;
        }

        // Hide the loading dialog (but make sure the user has enough time to read the message)
        setTimeout( function() {
            $( '#loading-wrapper' ).addClass( 'hidden' );
        }, 850 );

        // Add 'sortable' drag-and-drop behavior to the card container
        $( '#tab-content' ).sortable(
            {
                items: '> .card',
                axis: 'x',
                opacity: 0.5,
                cursor: 'move',
                placeholder: 'card-placeholder',
                cancel: '.card-content, .searchbar',
                containment: 'parent',
                tolerance: 'pointer',
                update: function( event, ui ) { saveSession(); },
            }
        );

        // Add 'sortable' drag-and-drop behavior to the tab container
        $( '#tab-bar' ).sortable(
            {
                items: '> .tab',
                axis: 'x',
                cursor: 'move',
                placeholder: 'tab-placeholder',
                containment: 'parent',
                tolerance: 'pointer',
                update: function( event, ui ) { saveSession(); },
            }
        );

        // Add a keydown handler for hotkeys
        $( document ).keydown( handleHotkeys );

        // If a previous session exists, load it
        if ( localStorage.getItem( 'lastSessionData' ) !== null )
        {
            loadSessionFromJSON( localStorage.getItem('lastSessionData') );
        }

        // Otherwise, set up an empty tab and activate it
        else
        {
            addTab();
            $( '.tab' ).click();
        }

        // Add a scroll event handler to check for cards becoming visible
        $( '#tab-content' ).scroll( checkVisibleCards );

        // Begin processing queries in the search queue
        processQueries();

    }

    // Check that the document is ready
    if ( document.readyState == 'complete' )
    {
        enableApp();
    }

    // Document is not ready yet, when CSE element is initialized
    else
    {
        google.setOnLoadCallback( enableApp, true );
    }

}

// Point GCSE at the init function and disable automatic query parsing from the page URL
window.__gcse = {
    initializationCallback: GCSEInit,
    parsetags: 'explicit',
};

/******************************/
/* $.isInViewport
 * jQuery extension function that reports whether or not $(this) is at least partially visible
 */

$.fn.isInViewport = function () {
    let elementLeft = $(this).offset().left;
    let elementRight = elementLeft + $(this).outerWidth();
    let viewportLeft = $( document ).scrollLeft();
    let viewportRight = viewportLeft + $( document ).width();
    return (elementRight > viewportLeft && elementRight < viewportRight) || (elementLeft > viewportLeft && elementLeft < viewportRight);
};

/******************************/
/* processQueries
 * Triggers after random timeouts and processes query requests in the search query queue
 */
function processQueries()
{

    // Grab the top query out of the queue
    var query = queryQueue.shift();

    // If the query exists, grab the target results element and execute the query
    if ( query !== undefined )
    {
        let results = google.search.cse.element.getElement( query.id + '-results' );
        results.execute( query.query );
    }

    // Prepare to do this again in 100-400ms
    var randTimeout = Math.round( Math.random() * 300 ) + 100;
    setTimeout( processQueries, randTimeout );

}

/******************************/
/* checkVisibleCards
 * Populates any non-hidden, visible, unpopulated card with search results
 */

function checkVisibleCards()
{

    /**********/
    /* updateCards
     * Executes the search query of any non-hidden, visible, unpopulated card
     */
    function updateCards()
    {

        // Iterate over every non-hidden card
        $( '.card:not(.hidden)' ).each(function (index) {

            // Check that the card is visible and unpopulated
            if ( $( this ).isInViewport() && $( this ).attr('data-populated') === '0' )
            {

                // Mark the card as populated
                $( this ).attr( 'data-populated', 1 );

                // Add its query to the queue
                queryQueue.push({
                    id: $( this ).attr( 'id' ).replace( '-card', '' ),
                    query: $( this ).children('.searchbar')[0].value.trim(),
                });

            }

        });

        // Clear the card update timer
        checkVisibleCards.timerID = null;

    }

    // If a timer to update the cards doesn't already exist, set a new one
    // (This prevents the check from being run more than 3 times a second)
    if ( typeof( checkVisibleCards.timerID ) === 'undefined' || checkVisibleCards.timerID === null )
    {
        checkVisibleCards.timerID = setTimeout( updateCards, 333 );
    }

}

/******************************/
/* addCard
 * Adds a new card to the current tab
 */

function addCard( id = ++cardCounter, tab = currentTab, query = '' )
{

    // Prepare card HTML and CSE data templates
    let cardHTML = cardHTMLTemplate.replace( /\$/g, id ).replace( /\!/g, tab );
    let cseData = { ...cseTemplate };
    cseData.div = cseData.div.replace( '$', id );
    cseData.gname = cseData.gname.replace( '$', id );

    // Add the card to the page and render the CSE results element
    $( '.spacer:last-child' ).before( cardHTML );
    google.search.cse.element.render( cseData );

    // Add our handler function for the blur (lost focus) and keypress events to the searchbar
    let $searchbar = $( '#' + id + '-input' );
    $searchbar.blur( updateSearchResults ).keypress( updateSearchResults );

    // If this is a blank new card, give the searchbar keyboard focus
    if ( query === '' )
    {
        $searchbar.focus();
    }

    // Otherwise, just fill out the searchbar with the provided value
    // (The query will be run later when the card becomes visible)
    else
    {
        $searchbar.val( query );
    }

}

/******************************/
/* addTab
 * Adds a new tab to the session
 */

function addTab( id = ++tabCounter, name = 'New Tab' )
{

    // Prepare tab HTML
    let tabHTML = tabHTMLTemplate.replace( /\!/g, id ).replace( /\@/g, name );

    // Add the tab to the page
    $( '#new-tab-button' ).before( tabHTML );

    // Add our handler function selecting the new tab
    $( '#' + id + '-tab' ).click( selectTab );

    // Save the session
    saveSession();

}

/******************************/
/* selectTab
 * Selects a new active tab
 */

function selectTab( event )
{

    // Get the ID of the selected tab and change the current tab ID
    let tabID = $( event.currentTarget ).attr( 'id' ).replace( '-tab', '' );
    currentTab = tabID;

    // Deselect the old active tab and register the onclick handler for it
    $( '.tab.active' ).removeClass( 'active' ).click( selectTab );

    // Hide all non-hidden cards not belonging to our new tab
    $( '.card:not([data-tab=' + currentTab + ']):not(.hidden)' ).addClass( 'hidden' );

    // Activate our new tab and display its name in the header
    $( '#' + currentTab + '-tab' ).addClass( 'active' ).unbind( 'click' );
    $( '#tab-header h1' ).html( $( '.tab.active').html() );

    // Un-hide all of the cards for the new tab
    $( '.card[data-tab=' + currentTab + '].hidden' ).removeClass('hidden');

    // Un-focus whatever the user was focused on before (in case that element is now hidden)
    $( ':focus' ).blur();

    // Run a check on which cards are visible now that the tab has changed
    checkVisibleCards();

    // Save the session
    saveSession();

}

/******************************/
/* renameTab
 * Prompts the user for a new name for the active tab
 */

function renameTab()
{

    // Grab the active tab element
    let $activeTab = $( '.tab.active' );

    // Prompt the user for a new tab name
    let newName = prompt( 'Enter a new tab name for "' + $activeTab.html() + '".' ).trim();
    if ( newName !== null && newName !== '' )
    {
        $activeTab.html( newName );
        $( '#tab-header h1' ).html( $( '.tab.active').html() );
    }

    // Save the session
    saveSession();

}

/******************************/
/* deleteTab
 * Prompts the user, then deletes the active tab and its children
 */

function deleteTab()
{

    // Grab the active tab element
    let $activeTab = $( '.tab.active' );

    // Make sure that this isn't the only tab
    if ( $( '.tab' ).length === 1 )
    {
        alert( 'You cannot delete your only tab!' );
        return;
    }

    // Ask the user if they'd like to proceed
    if ( !confirm( 'Are you sure you would like to delete the tab "' + $activeTab.html() + '"?' ) )
    {
        return
    }

    // Delete all cards that are children of the current tab
    $( '.card[data-tab=' + currentTab + ']' ).remove();

    // Move over to the previous or next tab before deleting the tab itself
    if ( $activeTab.prev().length === 1 )
    {
        $activeTab.prev().click();
    }
    else
    {
        $activeTab.next().click();
    }

    // Delete the tab
    $activeTab.remove();

    // Save the session
    saveSession();

}

/******************************/
/* updateSearchResults
 * Handles keypress and blur events from search boxes,
 * triggering a search in the CSE results window of that card
 */

function updateSearchResults( event )
{

    // If this was triggered by a keypress, check which key was pressed
    if ( event.type === 'keypress' )
    {

        // Otherwise, if the key wasn't enter, don't proceed
        if ( event.keyCode !== 13 )
        {
            return;
        }

    }

    // Grab the ID of the card in which the event ocurred
    let cardID = $( event.currentTarget ).attr( 'id' ).replace( '-input', '' );

    // Grab the CSE search results element and the searchbar element
    let $input = $( event.currentTarget );

    // If the searchbar is empty, clear the results element
    if ( $input.val().trim() === '' )
    {
        $( '#' + cardID + '-card' ).remove();
    }

    // Otherwise, add the query to the queue and mark this card as populated
    else
    {
        $( '#' + cardID + '-card' ).attr( 'data-populated', 1 );
        queryQueue.push({
            id: cardID,
            query: $input.val().trim(),
        });
    }

    // Take focus off of the searchbar
    // (Make sure this wasn't triggered by blur() already in order to prevent recursion)
    if ( event.type === 'keypress' )
    {
        $input.blur();
    }

    // Save the session
    saveSession();

}

/******************************/
/* handleHotkeys
 * Handle keypresses and trigger behaviors for recognized hotkeys
 */

function handleHotkeys( event )
{

    // Tab key
    if ( event.which === 9 )
    {

        // If the user is not focused on a searchbar, place focus on the first (visible) card's searchbar
        if ( !$( ':focus' ).hasClass('searchbar') )
        {
            event.preventDefault();
            $( '.searchbar:visible:first' ).focus();
        }

    }

    // ? Key
    else if ( event.which === 191 )
    {

        // Show or hide the keyboard shortcut guide
        $( '#key-guide-wrapper' ).toggleClass( 'hidden' );
    }

    // Alt key combos
    else if ( event.altKey )
    {

        // Alt+O (Export session)
        if ( String.fromCharCode( event.which ) === 'O' )
        {
            event.preventDefault();
            $( '#export-session-button' ).click();
        }

        // Alt+Z (Delete tab)
        else if ( String.fromCharCode( event.which ) === 'Z' )
        {
            event.preventDefault();
            $( '#delete-tab-button' ).click();
        }

        // Alt+R (Rename tab)
        else if ( String.fromCharCode( event.which ) === 'R' )
        {
            event.preventDefault();
            $( '#rename-tab-button' ).click();
        }

        // Alt+C (New card)
        else if ( String.fromCharCode( event.which ) === 'C' )
        {
            event.preventDefault();
            $( '#new-card-button' ).click();
        }

        // Alt+N (New tab)
        // NOTE: Also includes secondary behavior of switching to new tab
        else if ( String.fromCharCode( event.which ) === 'N' )
        {
            event.preventDefault();
            $( '#new-tab-button' ).click();
            $( '.tab:last-of-type' ).click();
        }

        // Alt+J/Alt+Left (Prev. tab)
        else if ( String.fromCharCode( event.which ) === 'J' || event.which === 37 )
        {
            event.preventDefault();
            $( '.tab.active' ).prev().click();
        }

        // Alt+K/Alt+right (Next. tab also yikes)
        else if ( String.fromCharCode( event.which ) === 'K' || event.which === 39 )
        {

            // This is necessary to prevent clicking the new tab button...
            let $nextTab = $( '.tab.active' ).next();
            if ( $nextTab.hasClass( 'tab' ) )
            {
                event.preventDefault();
                $nextTab.click();
            }

        }

        // Alt+, (Scroll left)
        else if ( event.which === 188 )
        {
            event.preventDefault();
            let $tabContent = $( '#tab-content' );
            $tabContent.stop().animate({
                scrollLeft: $tabContent.scrollLeft() - 275,
            },{
                easing: 'linear',
                duration: 100,
            });
        }

        // Alt+. (Scroll right)
        else if ( event.which === 190 )
        {
            event.preventDefault();
            let $tabContent = $( '#tab-content' );
            $tabContent.stop().animate({
                scrollLeft: $tabContent.scrollLeft() + 275,
            },{
                easing: 'linear',
                duration: 100,
            });
        }

    }

}

/******************************/
/* clearSession
 */

function clearSession()
{

    // Ask the user if they'd like to proceed
    if ( !confirm( 'Are you sure you would like to clear this session? All tabs and cards will be lost.' ) )
    {
        return;
    }

    // Clear the session by removing all tabs and cards
    $( '.tab' ).remove();
    $( '.card' ).remove();

    // Add an empty tab and activate it
    addTab();
    $( '.tab' ).click();

}

/******************************/
/* saveSession
 * Converts the session data to JSON and saves it to Web Storage
 * (Unless a session is currently being imported)
 */

function saveSession()
{

    // Only save the session if we're not currently importing a session
    if ( !importing )
    {
        var sessionJSON = sessionToJSON();
        localStorage.setItem( 'lastSessionData', sessionJSON );
    }

}

/******************************/
/* exportSession
 * Exports the current session data to a downloadable file
 */

function exportSession()
{

    // Create an invisible link containing the downloadable session data
    var link = document.createElement( 'a' );
    link.setAttribute( 'href', 'data:text/plain;charset=utf-8,' + encodeURIComponent( sessionToJSON() ) );
    link.setAttribute( 'download', 'My Session.refcab' );

    // Trigger a click event to download the data to a file
    link.click();

}

/******************************/
/* importSession
 * Imports session data from a JSON file
 */

function importSession()
{

    // Get the selected file from the invisible file input
    let file = $( '#file-input' ).get( 0 ).files[ 0 ];

    // If nothing was selected by the user, stop here
    if ( file === undefined )
    {
        return;
    }

    // Read the text from the file
    let reader = new FileReader();
    reader.onload = handleFile;
    reader.readAsText( file );

    // Load a session from the text (which should hopefully be valid JSON)
    function handleFile()
    {
        loadSessionFromJSON( reader.result );
    }

    // Save newly-imported session
    saveSession();

}

/******************************/
/* loadSessionFromJSON
 * Loads data into the session from a JSON string
 */

function loadSessionFromJSON( sessionJSON )
{

    // Parse the session data
    let sessionData = JSON.parse( sessionJSON );

    // Perform some basic sanity checks before continuing
    if ( typeof( sessionData.currentTab ) !== 'string' ||
         typeof( sessionData.cardCounter ) !== 'number' ||
         typeof( sessionData.tabCounter ) !== 'number' ||
         typeof( sessionData.tabs ) !== 'object' ||
         typeof( sessionData.cards ) !== 'object' )
    {
        alert( 'Provided session data is invalid. Cancelling loading process.' );
        return;
    }

    // Clear the session by removing all tabs and cards
    $( '.tab' ).remove();
    $( '.card' ).remove();

    // Set the new counter values from the JSON data
    currentTab = sessionData.currentTab;
    cardCounter = sessionData.cardCounter;
    tabCounter = sessionData.tabCounter;

    importing = true;

    // Load the tabs into the page
    for ( const tab of sessionData.tabs ) {
        addTab( tab.id, tab.name );
    }

    // Load the cards into the page
    for ( const card of sessionData.cards ) {
        addCard( card.id, card.tab, card.query );
    }

    // Activate the appropriate tab
    $( '#' + currentTab + '-tab' ).click();

    importing = false;

}

/******************************/
/* sessionToJSON
 * Converts the current session data into a JSON string
 */

function sessionToJSON()
{

    // Create session data object
    let sessionData = {
        currentTab: currentTab,
        cardCounter: cardCounter,
        tabCounter: tabCounter,
        tabs: [],
        cards: [],
    };

    // Save all tabs
    $( '.tab' ).each( function ( index ) {
        let tabData = {};
        tabData.id = $( this ).attr( 'id' ).replace( '-tab', '' );
        tabData.name = $( this ).html();
        sessionData.tabs.push( tabData );
    });

    // Save all cards
    $( '.card' ).each( function ( index ) {
        let cardData = {};
        cardData.id = $( this ).attr( 'id' ).replace( '-card', '' );
        cardData.tab = $( this ).attr( 'data-tab' );
        cardData.query = $( '#' + cardData.id + '-input' ).val().trim();
        if ( cardData.query !== '' )
        {
            sessionData.cards.push( cardData );
        }
    });

    return JSON.stringify( sessionData );

}
