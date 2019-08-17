const fs = require('fs');
const path = require('path');
const commander = require('commander');
const {yellow, magenta, red} = require('kleur');
const {sub_domain} = require('./references.js');
const {get_request, handle_error, render_spinner, green_bg, cyan_bg} = require('./utilities.js');
const {download_hls_video, download_mp4_video} = require('./download_video.js');
const {download_supplementary_assets} = require('./download_assets');

const create_chapter_folder = (content, course_path) => {
	const chapter_response_index = `${content[0]['object_index']}`;
	const chapter_name = `${chapter_response_index.padStart(2, '0')} ${content[0]['title']}`.replace(
		/[/\\?%*:|"<>$]/g,
		'_'
	);

	console.log(`\n${green_bg('Chapter')}  ${chapter_name}`);

	const chapter_path = path.join(course_path, chapter_name);

	try {
		if (!fs.existsSync(chapter_path)) {
			fs.mkdirSync(chapter_path);
		}

		return chapter_path;
	} catch (error) {
		handle_error(error['message']);
	}
};

const download_lecture_article = (content, chapter_path) => {
	const article_response_index = `${content[0]['object_index']}`;
	const article_name = `${article_response_index.padStart(3, '0')} ${content[0]['title']}.html`.replace(
		/[/\\?%*:|"<>$]/g,
		'_'
	);
	const article_body = content[0]['asset']['body'].replace(/\\\"/g, '"').replace(/\n+/g, '<br>');

	const new_article_body = `<html><head><link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css" integrity="sha384-BVYiiSIFeK1dGmJRAkycuHAHRg32OmUcww7on3RYdg4Va+PmSTsz/K68vbdEjh4u" crossorigin="anonymous"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.4.1/components/image.min.css"></head><body><div class="container"><div class="row"><div class="col-md-10 col-md-offset-1 ui image"><p class="lead">${article_body}</p></div></div></div></body></html>`;

	const article_path = path.join(chapter_path, article_name);

	fs.writeFileSync(article_path, new_article_body);

	console.log(`\n  ${magenta().inverse(' Lecture ')}  ${article_name}  ${green_bg('Done')}`);

	if (content[0]['supplementary_assets'].length > 0) {
		download_supplementary_assets(
			content[0]['supplementary_assets'],
			chapter_path,
			article_response_index.padStart(3, '0')
		);
	}
};

const download_subtitles = (sub, video_name, chapter_path) => {
	const subtitle_request_headers = {
		'User-Agent': 'okhttp/3.11.0'
	};

	if (commander.lang) {
		const lang = sub.find(lang =>
			lang['locale_id'].toLowerCase().includes(commander.lang.toLowerCase())
		);

		if (lang) {
			sub = [lang];
		}
	}

	try {
		sub.forEach(async subtitle => {
			const subtitle_url = subtitle['url'];
			const subtitle_lang = subtitle['locale_id'];

			const response = await get_request(subtitle_url, subtitle_request_headers);

			// From @wopen/vtt2srt npm package
			const data = response['body']
				.replace(/^WEBVTT/g, '')
				.replace(/(\d\d:\d\d)\.(\d\d\d)\b/g, '$1,$2')
				.replace(/(\n|\s)(\d\d:\d\d,\d\d\d)(\s|\n)/g, '$100:$2$3')
				.trim()
				.split(/(?:\r\n\r\n|\n\n|\r\r)/g)
				.map((piece, i) => `${i + 1}\n${piece}\n\n`)
				.join('');

			fs.writeFileSync(path.join(chapter_path, `${video_name}.${subtitle_lang}.srt`), data);
		});
	} catch (error) {
		handle_error(error['message']);
	}
};

const download_lecture_video = async (content, course_path, chapter_path) => {
	if (content.length === 0) {
		process.exit();
	}

	if (content[0]['_class'] === 'chapter') {
		chapter_path = create_chapter_folder(content, course_path);
		content.shift();
		if (content.length === 0) {
			return;
		}
	}

	if (content[0]['_class'] === 'lecture' && content[0]['asset']['asset_type'] === 'Article') {
		download_lecture_article(content, chapter_path);
		content.shift();
		if (content.length === 0) {
			return;
		}
	}

	if (content[0]['_class'] === 'lecture' && content[0]['asset']['asset_type'] === 'Video') {
		const video_lecture = content[0];

		const lecture_index = `${video_lecture['object_index']}`;
		const video_name = `${lecture_index.padStart(3, '0')} ${video_lecture['title']}`.replace(
			/[/\\?%*:|"<>$]/g,
			'_'
		);

		if (!commander.skipSub) {
			if (video_lecture['asset']['captions'].length !== 0) {
				download_subtitles(video_lecture['asset']['captions'], video_name, chapter_path);
			}
		}

		if (video_lecture['supplementary_assets'].length > 0) {
			download_supplementary_assets(
				video_lecture['supplementary_assets'],
				chapter_path,
				lecture_index.padStart(3, '0')
			);
		}

		if (video_lecture['asset']['url_set']) {
			const check_spinner = {stop: 0};

			try {
				if (fs.existsSync(path.join(chapter_path, `${video_name}.mp4`))) {
					console.log(`\n  ${magenta().inverse(' Lecture ')}  ${video_name}  ${yellow('(already downloaded)')}`);

					content.shift();
					return await download_lecture_video(content, course_path, chapter_path);
				}

				console.log();

				render_spinner(check_spinner, `${magenta().inverse(' Lecture ')}  ${video_name}`);

				const urls_location = video_lecture['asset']['url_set']['Video'];
				const hls_link = video_lecture['asset']['hls_url'];

				if (hls_link) {
					await download_hls_video(`https${hls_link.slice(5)}`, video_name, chapter_path);
				} else {
					await download_mp4_video(urls_location, video_name, chapter_path);
				}

				clearTimeout(check_spinner.stop);

				content.shift();
				await download_lecture_video(content, course_path, chapter_path);
			} catch (error) {
				clearTimeout(check_spinner.stop);

				if (error['message'] === '403') {
					console.log(`  ${yellow('(fail to connect, retrying)')}`);

					throw new Error(JSON.stringify({
						lecture_id: video_lecture['id'],
						chapter_path
					}));
				}

				throw new Error(error['message']);
			}
		}
	} else {
		await download_lecture_video(content, course_path, chapter_path);
	}
};

const filter_lecture = (data) => {
	const lecture_index = data.findIndex(l => l['_class'] === 'lecture' && l['object_index'] === parseInt(commander.lecture, 10));

	if (lecture_index !== -1) {
		const chapter_with_lecture = data.slice(0, lecture_index).reverse().find(c => c['_class'] === 'chapter');

		return [chapter_with_lecture, data[lecture_index]];
	}

	handle_error('Unable to find the lecture');
};

const filter_course_data = (data, start, end) => {
	const lectures = data.filter(content => {
		return (
			content['_class'] === 'chapter' ||
			(content['_class'] === 'lecture' &&
				content['asset']['asset_type'] === 'Video') ||
			(content['_class'] === 'lecture' &&
				content['asset']['asset_type'] === 'Article')
		);
	});

	if (lectures[0]['_class'] !== 'chapter') {
		const lost_chapter_name = lectures[0]['title'];
		const lost_chapter = {
			_class: 'chapter',
			title: lost_chapter_name,
			object_index: 1
		};

		lectures.forEach(content => content['_class'] === 'chapter' && content['object_index']++);

		lectures.unshift(lost_chapter);
	}

	if (commander.lecture) {
		return filter_lecture(lectures);
	}

	const chapters = data.filter(c => c['_class'] === 'chapter');

	if (start && parseInt(start, 10) <= chapters.length) {
		const start_index = lectures.findIndex(c => c['_class'] === 'chapter' && c['object_index'] === parseInt(start, 10));
		if (parseInt(end, 10) > parseInt(start, 10)) {
			const end_index = lectures.findIndex(c => c['_class'] === 'chapter' && c['object_index'] === parseInt(end, 10));
			if (end_index !== -1) {
				return lectures.splice(start_index, end_index - start_index);
			}
		}

		return lectures.splice(start_index);
	}

	if (start && parseInt(start, 10) > chapters.length) {
		handle_error(`Course only have ${yellow(chapters.length)} chapters but you start at chapter ${red(start)}`);
	}

	if (end && parseInt(end, 10) <= chapters.length) {
		const end_index = lectures.findIndex(c => c['_class'] === 'chapter' && c['object_index'] === parseInt(end, 10));
		return lectures.splice(0, end_index);
	}

	return lectures;
};

const download_course_info = async (course_content_url, auth_headers) => {
	const response = await get_request(course_content_url, auth_headers);

	const data = JSON.parse(response.body).results;

	return filter_course_data(data, commander.chapterStart, commander.chapterEnd);
};

const download_course_one_request = async (course_content_url, auth_headers, course_path) => {
	const check_spinner = {stop: 0};
	try {
		console.log('\n');
		render_spinner(check_spinner, `${cyan_bg('Getting course information')}`);

		const lectures = await download_course_info(`${course_content_url}10000`, auth_headers);

		console.log(`  ${green_bg('Done')}`);
		clearTimeout(check_spinner.stop);

		await download_lecture_video(lectures, course_path);
	} catch (error) {
		if (error['statusCode'] === 502) {
			const lectures = await download_course_multi_requests(`${course_content_url}200`, auth_headers, check_spinner);

			await download_lecture_video(lectures, course_path);
		} else if (error['code'] === 'ENOTFOUND') {
			handle_error('Unable to connect to Udemy server');
		} else if (error['message'].includes('lecture_id')) {
			const {lecture_id, chapter_path} = JSON.parse(error['message']);

			const lectures = await download_course_info(`${course_content_url}10000`, auth_headers);

			const start_again_lecture = lectures.findIndex(content => content['id'] === lecture_id);

			await download_lecture_video(lectures.slice(start_again_lecture), course_path, chapter_path);
		}

		handle_error(error['message']);
	}
};

const download_course_multi_requests = async (course_content_url, auth_headers, check_spinner, previous_data = []) => {
	try {
		if (!course_content_url) {
			console.log(`  ${green_bg('Done')}`);
			clearTimeout(check_spinner.stop);

			return previous_data;
		}

		const response = await get_request(course_content_url, auth_headers);

		const data = JSON.parse(response.body);
		previous_data = [...previous_data, ...data['results']];
		await download_course_multi_requests(data['next'], auth_headers, check_spinner, previous_data);
	} catch (error) {
		handle_error(error['message']);
	}
};

const download_course_contents = async (course_id, auth_headers, course_path) => {
	const course_content_url = `https://${sub_domain}.udemy.com/api-2.0/courses/${course_id}/subscriber-curriculum-items/?fields[lecture]=supplementary_assets,title,asset,object_index&fields[chapter]=title,object_index,chapter_index,sort_order&fields[asset]=title,asset_type,length,url_set,hls_url,captions,body,file_size,filename,external_url&page=1&locale=en_US&page_size=`;

	await download_course_one_request(course_content_url, auth_headers, course_path);
};

module.exports = {
	download_course_contents
};
