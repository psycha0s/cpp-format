import * as vscode from 'vscode';
import cp = require('child_process');
import path = require('path');
import sax = require('sax');

export let outputChannel = vscode.window.createOutputChannel('cpp-format');


function getPlatformString() {
	switch(process.platform) {
		case 'win32': return 'windows';
		case 'linux': return 'linux';
		case 'darwin': return 'osx';
	}

	return 'unknown';
}

export class CppFormat implements vscode.DocumentFormattingEditProvider,
	vscode.DocumentRangeFormattingEditProvider,
	vscode.OnTypeFormattingEditProvider {

	public provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return this.doFormat(document, null, options, token);
	}

	public provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		range: vscode.Range,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return this.doFormat(document, range, options, token);
	}

	private lastIndexNotOf(pos: number, text: string, chars: string) {
		while(pos >= 0 && chars.includes(text[pos])) {
			--pos;
		}

		return pos;
	}

	private lastIndexOfMatchingChar(pos: number, text: string, chars: string) {
		let level = 1;

		while(pos >= 0) {
			if(text[pos] === chars[1]) {
				level++;
			}
			else if(text[pos] === chars[0]) {
				level--;
			}

			if(level === 0) {
				break;
			}

			--pos;
		}

		return pos;
	}

	private lastIndexOfNonAlpha(pos: number, text: string) {
		while(pos >= 0 && /^[A-Z]$/i.test(text[pos])) {
			--pos;
		}

		return pos;
	}

	private isControlStatement(pos: number, text: string) {
		pos = this.lastIndexNotOf(pos, text, ' \t\r\n');
		if(pos < 0) { return; }

		if(text[pos] === ')') {
			pos = this.lastIndexOfMatchingChar(pos - 1, text, '()');
			if(pos < 0) { return; }

			pos = this.lastIndexNotOf(pos - 1, text, ' \t\r\n');
			if(pos < 0) { return; }

			let end = pos + 1;
			pos = this.lastIndexOfNonAlpha(pos, text);
			if(pos < 0) { pos = 0; }

			let keyword = text.substr(pos + 1, end - pos - 1);
			const keywords = new Set(['do', 'for', 'if', 'while']);
			return keywords.has(keyword);
		}
		else if(pos >= 4 && text.substring(pos - 3, pos + 1) === 'else') {
			return true;
		}

		return false;
	}

	public provideOnTypeFormattingEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		ch: string,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
		let text = document.getText();
		let pos = document.offsetAt(position);

		if(ch === '}') {
			pos = this.lastIndexOfMatchingChar(pos, text, '{}');
			let range = new vscode.Range(document.positionAt(pos), position);
			return this.doFormat(document, range, options, token);
		}
		else if(ch === '\n') {
			if(this.isControlStatement(pos, text)) {
				let edits: vscode.TextEdit[] = [];
				let editRange = new vscode.Range(position, position);
				let editor = vscode.window.activeTextEditor;
				if(!editor) { return; }

				if(editor.options.insertSpaces) {
					let tabSize = editor.options.tabSize as number;
					let indent = ' '.repeat(tabSize);
					edits.push(new vscode.TextEdit(editRange, indent));
				}
				else {
					edits.push(new vscode.TextEdit(editRange, '\t'));
				}

				return edits;
			}
			else {
				if(position.line < 2) { return; }
				let line = document.lineAt(position.line - 2);
				pos = document.offsetAt(line.range.end);
				let count = 0;

				while(this.isControlStatement(pos, text)) {
					count++;
					if(line.lineNumber < 0) { break; }
					line = document.lineAt(line.lineNumber - 1);
					pos = document.offsetAt(line.range.end);
				}

				if(count) {
					let editor = vscode.window.activeTextEditor;
					if(!editor) { return; }
					let edits: vscode.TextEdit[] = [];


					if(editor.options.insertSpaces) {
						let tabSize = editor.options.tabSize as number;
						let begin = position.translate(0, -(tabSize * count));
						let editRange = new vscode.Range(begin, position);
						edits.push(vscode.TextEdit.delete(editRange));
					}
					else {
						let begin = position.translate(0, -count);
						let editRange = new vscode.Range(begin, position);
						edits.push(vscode.TextEdit.delete(editRange));
					}

					return edits;
				}
			}
		}
	}

	public doFormat(
		document: vscode.TextDocument,
		range: vscode.Range | null,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return new Promise((resolve, reject) => {
			console.log(range);
			let text = document.getText();
			let formatArgs = ['-output-replacements-xml'];

			if(range) {
				let pos = document.offsetAt(range.start);
				pos = this.lastIndexNotOf(pos, text, ' \t\r\n');
				if(pos < 0) { return; }

				range = new vscode.Range(document.positionAt(pos), range.end);

				let offset = document.offsetAt(range.start);
				let length = document.offsetAt(range.end) - offset;

				// fix charater length to byte length
				length = Buffer.byteLength(text.substr(offset, length), 'utf8');
				// fix charater offset to byte offset
				offset = Buffer.byteLength(text.substr(0, offset), 'utf8');

				formatArgs.push(`-offset=${offset}`, `-length=${length}`);
			}

			let stdout = '';
			let stderr = '';
			let workingPath = path.dirname(document.fileName);
			let executable = this.getExecutablePath();
			let child = cp.spawn(executable, formatArgs, { cwd: workingPath });
			child.stdin.end(text);
			child.stdout.on('data', chunk => stdout += chunk);
			child.stderr.on('data', chunk => stderr += chunk);

			child.on('error', err => {
				if(err && (<any>err).code === 'ENOENT') {
					vscode.window.showInformationMessage('The \'clang-format\' command is not available.');
					return reject();
				}

				return reject(err);
			});

			child.on('close', code => {
				try {
					if(stderr.length !== 0) {
						outputChannel.show();
						outputChannel.clear();
						outputChannel.appendLine(stderr);
						return reject('Cannot format due to syntax errors.');
					}

					if(code !== 0) {
						return reject();
					}

					console.log(stdout);
					return resolve(this.getEdits(document, range, stdout, text));
				}
				catch(e) {
					reject(e);
				}
			});

			if(token) {
				token.onCancellationRequested(() => {
					child.kill();
					reject('Cancelation requested');
				});
			}
		});
	}

	private getEdits(
		document: vscode.TextDocument,
		range: vscode.Range | null,
		xml: string,
		codeContent: string): Thenable<vscode.TextEdit[]> {
		return new Promise((resolve, reject) => {
			let options = {
				trim: false,
				normalize: false,
				loose: true
			};

			let parser = sax.parser(true, options);
			let edits: vscode.TextEdit[] = [];
			let currentEdit: { length: number, offset: number, text: string };
			let hasEdit: boolean;

			let codeBuffer = Buffer.from(codeContent);

			// encoding position cache
			let codeByteOffsetCache = {
				byte: 0,
				offset: 0
			};

			let byteToOffset = function (editInfo: { length: number, offset: number }) {
				let offset = editInfo.offset;
				let length = editInfo.length;

				if(offset >= codeByteOffsetCache.byte) {
					editInfo.offset = codeByteOffsetCache.offset + codeBuffer.slice(codeByteOffsetCache.byte, offset).toString('utf8').length;
					codeByteOffsetCache.byte = offset;
					codeByteOffsetCache.offset = editInfo.offset;
				}
				else {
					editInfo.offset = codeBuffer.slice(0, offset).toString('utf8').length;
					codeByteOffsetCache.byte = offset;
					codeByteOffsetCache.offset = editInfo.offset;
				}

				editInfo.length = codeBuffer.slice(offset, offset + length).toString('utf8').length;

				return editInfo;
			};

			parser.onerror = (err) => {
				reject(err.message);
			};

			parser.onopentag = (tag) => {
				if(hasEdit) {
					reject('Malformed output');
				}

				switch (tag.name) {
					case 'replacements':
						return;

					case 'replacement':
						currentEdit = {
							length: parseInt(tag.attributes['length'].toString()),
							offset: parseInt(tag.attributes['offset'].toString()),
							text: ''
						};

						byteToOffset(currentEdit);
						hasEdit = true;
						break;

					default:
						reject(`Unexpected tag ${tag.name}`);
				}

			};

			parser.ontext = (text) => {
				if(!hasEdit) { return; }
				currentEdit.text = text;
			};

			parser.onclosetag = (tagName) => {
				if(!hasEdit) { return; }
				let start = document.positionAt(currentEdit.offset);
				let end = document.positionAt(currentEdit.offset + currentEdit.length);
				let editRange = new vscode.Range(start, end);

				if(!range || range.contains(editRange)) {
					edits.push(new vscode.TextEdit(editRange, currentEdit.text));
				}

				hasEdit = false;
			};

			parser.onend = () => {
				resolve(edits);
			};

			parser.write(xml);
			parser.end();

		});
	}

	private getExecutablePath() {
		let platform = getPlatformString();
		let config = vscode.workspace.getConfiguration('cpp-format');

		let platformExecPath = config.get<string>('executable.' + platform);
		let defaultExecPath = config.get<string>('executable');
		let execPath = platformExecPath || defaultExecPath;

		if(!execPath) {
			return "clang-format";
		}

		return execPath;
	}
}


export function activate(context: vscode.ExtensionContext) {
	let formatter = new CppFormat();
	let selector = { language: 'cpp', scheme: 'file' };

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(selector, formatter));

	context.subscriptions.push(
		vscode.languages.registerDocumentRangeFormattingEditProvider(selector, formatter));

	context.subscriptions.push(
		vscode.languages.registerOnTypeFormattingEditProvider(selector, formatter, '}', '\n'));
}

export function deactivate() { }
