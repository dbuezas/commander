let highlightedSuggestion;
const BOLD_START = '∑';
const BOLD_END = 'π';
const BOLD_START_REGEX = new RegExp(BOLD_START, 'g');
const BOLD_END_REGEX = new RegExp(BOLD_END, 'g');

function escapeHtml(unsafe) {
    return unsafe
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;')
       .replace(/'/g, '&#039;')
       .replace(BOLD_START_REGEX, '<b>')
       .replace(BOLD_END_REGEX, '</b>');
}

const disabledActionsPromise = chromePromise.storage.local.get('disabledActions');
async function getDisabledActions() {
  let { disabledActions } = await disabledActionsPromise;
  return disabledActions || {};
}

async function isActionDisabled(name) {
  return (await getDisabledActions())[name];
}

async function getEnabledSugestions() {
  disabledActions = await getDisabledActions();
  return defaultSugestions.filter(({ text }) => !disabledActions[text]);
}

async function getSwitchTabSugestions() {
    if (await isActionDisabled('Search in Tabs')) return [];
    const allTabs = await chromePromise.tabs.query({'windowId': chromePromise.windows.WINDOW_ID_CURRENT});
    return allTabs.map(tab => ({
      text: `Switch to: ${tab.title}`,
      keyword: tab.url.slice(0, 100),
      action: switchToTab(tab.id),
    }));
}

async function getUserCommandJSONSuggestions() {
    const items = await chromePromise.storage.local.get('userCommandJSON');
    var existingUserCommands = items.userCommandJSON || [];
    return existingUserCommands.map(userCommand => eval(`(${userCommand})`));
}

async function getSearchSuggestions() {
    const searchString = document.getElementById('command').value;
    const queryList = searchString.split(' ');
    const domain = queryList[0].toLowerCase();
    const searchQuery = queryList.slice(1).join(' ');
    const q = encodeURI(searchQuery);

    let searchDomain;
    let url;

    const enabledSugestions = await getEnabledSugestions();
    const match = enabledSugestions.find(function({triggers}){
      return triggers && triggers.includes(domain);
    });
    if (match) {
      return [{
        text: `${match.text}: ${searchQuery}`,
        action: async function() {
          await chromePromise.tabs.create({url: match.queryToUrl(q)});
        },
      }];
    }
    return [];
}

async function getFastSuggestions() {
  return [].concat(
    await getEnabledSugestions(),
    await getUserCommandJSONSuggestions(),
    await getSwitchTabSugestions(),
  );
}
async function getSlowSuggestions() {
  return [].concat(
    await getHistorySuggestions(),
    await getBookmarkSugestions(),
  );
}
let allSuggestionsPromise = getFastSuggestions();
allSuggestionsPromise.then(async function(fast) {
  const slow = await getSlowSuggestions();
  allSuggestionsPromise = Promise.resolve(
    fast.concat(slow)
  );
  fuzzySearch();
});


async function getBookmarkSugestions() {
    if (await isActionDisabled('Search in Bookmarks')) return [];
    const list = await chromePromise.bookmarks.getRecent(10000); // fetch all
    return list.map(({url, title}) => ({
      text: `Bookmark: ${title}`,
      keyword: url.slice(0, 100),
      action: async function() {
        await chromePromise.tabs.create({url});
      },
    }));
}

async function getHistorySuggestions() {
    if (await isActionDisabled('Search in History')) return [];
    const list = await chromePromise.history.search({text: '', startTime:0, maxResults: 0}); // fetch all
    return list.map(({url, title, lastVisitTime}) => ({
      text: `History: ${title}`,
      keyword: url.slice(0, 100),
      extra: moment(lastVisitTime).fromNow(),
      action: async function() {
        await chromePromise.tabs.create({url});
      },
    }));
}

function scrollTo(highlightedSuggestion){
    try{
        scrollElement = highlightedSuggestion.previousSibling.previousSibling;
        scrollElement.scrollIntoView(/*alignToTop=*/true);
    }
    catch(err){}
}

function changeHighlighted(newHighlighted){
    highlightedSuggestion.id = '';
    highlightedSuggestion = newHighlighted;
    highlightedSuggestion.id = 'highlighted';
}

function handleKeydown(e){
  switch (e.which){
    case (40):{ // down
      const allSuggestions = document.getElementsByClassName('suggestion');
      const newSuggestion = highlightedSuggestion.nextSibling ||
        allSuggestions[allSuggestions.length - 1];
      changeHighlighted(newSuggestion);
      scrollTo(newSuggestion);
      return false;
    }
    case (38):{ // up
      e.preventDefault();
      const newSuggestion =
        highlightedSuggestion.previousSibling ||
        document.getElementsByClassName('suggestion')[0];
      changeHighlighted(newSuggestion);
      scrollTo(newSuggestion);
      return false;
    }
    case (13):{ // enter
      highlightedSuggestion.click();
    }
  }
}

function handleMouseover(e){
    changeHighlighted(e.srcElement);
}

function populateSuggestionsBox(suggestionList, onlyFirstN = true){
    var suggestionDiv = document.getElementById('suggestions');
    suggestionDiv.innerHTML = '';
    const maxSuggestions = 100;
    const mustSlice = onlyFirstN && suggestionList.length > maxSuggestions;
    let firstSuggestions = mustSlice ? suggestionList.slice(0,  maxSuggestions) : suggestionList;
    for (const suggestion of firstSuggestions) {
        var suggestionTag = document.createElement('li');
        suggestionTag.className = 'suggestion';
        suggestionTag.innerHTML = escapeHtml(suggestion.text);
        suggestionTag.onclick = async function() {
          try {
            await suggestion.action();
          } catch (e) {
            document.body.innerHTML = (`
              Error executing action [${escapeHtml(suggestion.text)}]:
              <pre style="color: red">
                ${escapeHtml(e.message)}
              </pre>
              Right click here and select [Inspect] to open DevTools in the action's context.
            `);
            console.error(suggestion.action.toString());
            console.error(e.message);
          }
        }
        suggestionTag.onmouseover = handleMouseover;
        if (suggestion.keyword) {
          const keywordTag = document.createElement('div');
          keywordTag.className = 'keyword';
          keywordTag.innerHTML = escapeHtml(suggestion.keyword);
          suggestionTag.appendChild(keywordTag);
        }
        if (suggestion.extra) {
          const keywordTag = document.createElement('div');
          keywordTag.className = 'extra';
          keywordTag.innerHTML = suggestion.extra;
          suggestionTag.appendChild(keywordTag);
        }
        suggestionDiv.appendChild(suggestionTag);
    }
    if (mustSlice) {
      var suggestionTag = document.createElement('li');
      suggestionTag.className = 'suggestion';
      suggestionTag.innerHTML = '...';
      suggestionTag.onclick = async function() {
        populateSuggestionsBox(suggestionList, false);
      };
      suggestionDiv.appendChild(suggestionTag);
      suggestionTag.onmouseover = handleMouseover;
    }
    highlightedSuggestion = document.getElementsByClassName('suggestion')[0];
    if (highlightedSuggestion){
        highlightedSuggestion.id = 'highlighted';
    }
}

async function fuzzySearch(){
    const allSuggestions = await allSuggestionsPromise;
    var searchString = document.getElementById('command').value;
    const options = {
      pre: BOLD_START, // before matched char
      post: BOLD_END, // after matched char
      sep: 'Ω', // between different fields
      extract: s => `${s.keyword || ''}${options.sep}${s.text || ''}`,
    };
    const searchResults = fuzzy
      .filter(searchString, allSuggestions, options)
      .map(el => {
        // fuzzy wraps every char with <pre> and <post> so first remove contiguous ones
        const delimited = el.string.replace(new RegExp(options.post + options.pre, 'g'), '');
        const [keyword, text] = delimited.split(options.sep);
        return Object.assign({}, el.original, { text, keyword });
      });

    const withSearches = (await getSearchSuggestions()).concat(searchResults);
    populateSuggestionsBox(withSearches);
}

function fixChromeBug() {
  // 20% of the time the popup animation breaks and it stays tiny
  // this seems to fix it
  // looks like an ancient issue...
  // https://productforums.google.com/forum/#!topic/chrome/4ofdh8EYL6Y
  const {offsetWidth} = document.body;
  const docStyle = document.documentElement.style;
  docStyle.width = offsetWidth - 1;
  setTimeout(function(){ docStyle.width = offsetWidth; }, 100);
}

async function initCommander() {
    fixChromeBug();
    fuzzySearch();
    // in a timeout to avoid blocking the ui while typing
    document.getElementById('command').oninput = function() {
      setTimeout(fuzzySearch, 0);
    };
    document.onkeydown = handleKeydown;
    const commands = await chromePromise.commands.getAll();
    const mainCommand = commands.find(({name}) => name === '_execute_browser_action');

    const shortcutEl = document.querySelector('#shortcutInfo #shortcutContainer a');
    shortcutEl.innerText = mainCommand.shortcut;
    shortcutEl.onclick = async function() {
      document.querySelector('#shortcutInfo').classList.add('clicked');
    };
    document.querySelector('#shortcutInfo #guide a').onclick = async function() {
      await chromePromise.tabs.create({url: 'chrome://extensions'});
    };

}

document.addEventListener('DOMContentLoaded', initCommander, false);
