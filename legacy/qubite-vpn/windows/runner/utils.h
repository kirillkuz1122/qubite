#ifndef RUNNER_UTILS_H_
#define RUNNER_UTILS_H_

#include <string>
#include <vector>

// Creates a console for the process, if not already attached to one.
void CreateAndAttachConsole();

// Takes a command line and tokenizes it into arguments.
std::vector<std::string> GetCommandLineArguments();

// Encode a wide string to UTF-8.
std::string Utf8FromUtf16(const wchar_t* utf16_string);

#endif  // RUNNER_UTILS_H_
