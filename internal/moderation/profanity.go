package moderation

import (
	"regexp"
	"strings"
	"unicode"
)

// Russian obscene vocabulary (мат) and slurs, matched per word after undoing the usual
// disguises: Latin look-alike letters, digits for letters, stretched letters, and
// separators inside a word («х.у.й», «б л я»). Plain insults are left to the model.
var obscene = []*regexp.Regexp{
	regexp.MustCompile(`ху[йеёяюи]`),
	regexp.MustCompile(`^(на|по|ни)?хул[иья]$`),
	regexp.MustCompile(`пи[зс]д`),
	regexp.MustCompile(`^(вы|у|за|на|от|об|по|до|под|пере|про|при|раз|рас|съ|въ|разъ|объ|подъ|долбо|недо|еле)?[её]б([аеёиоуыюялнтсшкщ]|$)`),
	regexp.MustCompile(`^бля([дт]|$)`),
	regexp.MustCompile(`^муд(ак|ач|ил|озв)`),
	regexp.MustCompile(`^пид[оае]?р`),
	regexp.MustCompile(`^педик(и|а|у|ом|ов)?$`),
	regexp.MustCompile(`^г[ао]нд[оа]н`),
	regexp.MustCompile(`шлюх`),
	regexp.MustCompile(`залуп`),
	regexp.MustCompile(`^(за|от|по|на)?дроч`),
	regexp.MustCompile(`^сук(а|и|ой|у|ам|ин|ен)?$`),
	regexp.MustCompile(`^сучк|^сучар`),
}

// Words that contain a pattern above but are fine.
var allowed = map[string]bool{
	"застрахуй": true, "застрахуйте": true, "страхуй": true, "страхуйте": true,
	"хуан": true, "хуанита": true, "хуанито": true,
}

// Transliterated Latin forms («hui», «blyat»).
var latin = regexp.MustCompile(`(^|[^a-z])(hu[iyj]|huev|pizd|blya[dt]|ebat|ebal|eban|yeba|pidor|pidar|suka|mudak|gandon)`)

var lookalike = map[rune]rune{
	'a': 'а', 'b': 'в', 'c': 'с', 'e': 'е', 'h': 'н', 'k': 'к', 'm': 'м', 'o': 'о', 'p': 'р',
	't': 'т', 'x': 'х', 'y': 'у', 'u': 'и', 'n': 'п', 'r': 'г',
	'0': 'о', '1': 'и', '3': 'з', '4': 'ч', '6': 'б', '@': 'а', 'ё': 'е',
}

// Obscene reports whether text contains мат or slurs.
func Obscene(text string) bool {
	lower := strings.ToLower(text)
	if latin.MatchString(lower) {
		return true
	}
	words := strings.Fields(lower)
	singles := ""
	flush := func() bool {
		hit := len([]rune(singles)) >= 3 && obsceneWord(singles)
		singles = ""
		return hit
	}
	for _, w := range words {
		n := normalize(w)
		if n == "" {
			continue
		}
		// «б л я» — a run of one-letter words is checked as one word.
		if len([]rune(n)) == 1 {
			singles += n
			continue
		}
		if flush() || obsceneWord(n) {
			return true
		}
	}
	return flush()
}

func obsceneWord(w string) bool {
	if allowed[w] {
		return false
	}
	for _, re := range obscene {
		if re.MatchString(w) {
			return true
		}
	}
	return false
}

// normalize maps look-alikes to Cyrillic, drops everything but letters and collapses
// repeated letters, so «Х*У*Й», «xyй» and «бляяяя» read as the plain word.
func normalize(w string) string {
	var b strings.Builder
	var last rune
	for _, r := range w {
		if m, ok := lookalike[r]; ok {
			r = m
		}
		if !unicode.IsLetter(r) || r == last {
			continue
		}
		b.WriteRune(r)
		last = r
	}
	return b.String()
}
